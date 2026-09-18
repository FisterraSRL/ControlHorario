/**
 * Azure SQL connection boundary.
 *
 * The shared database also contains Centraliza and FSTrack. Every query in this project
 * therefore names the `[controlhorario]` schema explicitly; the database user's default
 * schema is a secondary guard, never the mechanism that chooses a table.
 *
 * This module exposes the deliberately small query interface the repositories need. It
 * keeps parameter binding, JSON/date normalisation and transactions in one place instead
 * of leaking `mssql.Request` through the application.
 */

import sql from 'mssql';

import type { ConfiguracionApi } from './config.js';

export const ESQUEMA = 'controlhorario';

export interface ResultadoConsulta<T> {
  readonly rows: T[];
  readonly rowCount: number;
}

/**
 * A statement and the values it binds, as one value.
 *
 * It exists so a query whose WHERE clause depends on the caller — the sector-scoped reads of
 * `sectores.ts` — can be built by a pure function and asserted in a test, instead of being
 * assembled inline where only a live database could show what came out.
 */
export interface ConsultaSql {
  readonly texto: string;
  readonly valores: readonly unknown[];
}

export interface Consultable {
  query<T = Record<string, unknown>>(
    texto: string,
    valores?: readonly unknown[],
  ): Promise<ResultadoConsulta<T>>;
}

export interface PoolClient extends Consultable {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

export interface Pool extends Consultable {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

/** `$1`, `$2`, ... remains the repository-facing convention; Azure SQL receives `@p1`. */
function parametrizar(texto: string): string {
  return texto.replace(/\$(\d+)/g, (_coincidencia, numero: string) => `@p${numero}`);
}

function agregarParametros(request: sql.Request, valores: readonly unknown[]): void {
  valores.forEach((valor, indice) => {
    // `mssql` cannot infer a type from null. NVARCHAR NULL converts safely at the target
    // column/CASE expression and keeps repository calls compact.
    if (valor === null || valor === undefined) request.input(`p${indice + 1}`, sql.NVarChar, null);
    else request.input(`p${indice + 1}`, valor);
  });
}

const CAMPOS_JSON = new Set(['payload', 'datos', 'valor']);

function normalizarFila<T>(fila: Record<string, unknown>): T {
  const salida: Record<string, unknown> = { ...fila };
  for (const [campo, valor] of Object.entries(salida)) {
    if (campo === 'fecha' && valor instanceof Date) {
      salida[campo] = valor.toISOString().slice(0, 10);
      continue;
    }
    if (CAMPOS_JSON.has(campo) && typeof valor === 'string') {
      try {
        salida[campo] = JSON.parse(valor) as unknown;
      } catch {
        // A CHECK(ISJSON(...)) protects persisted values. Leaving an unexpected legacy
        // value untouched makes the validation layer report it with field context.
      }
    }
  }
  return salida as T;
}

async function ejecutar<T>(request: sql.Request, texto: string, valores: readonly unknown[] = []): Promise<ResultadoConsulta<T>> {
  agregarParametros(request, valores);
  const resultado = await request.query(parametrizar(texto));
  return {
    rows: (resultado.recordset ?? []).map((fila) => normalizarFila<T>(fila as Record<string, unknown>)),
    rowCount: resultado.rowsAffected.reduce((total, actual) => total + actual, 0),
  };
}

class ClienteTransaccion implements PoolClient {
  private finalizada = false;

  constructor(private readonly transaccion: sql.Transaction) {}

  async query<T = Record<string, unknown>>(
    texto: string,
    valores: readonly unknown[] = [],
  ): Promise<ResultadoConsulta<T>> {
    if (this.finalizada) throw new Error('La transacción ya terminó.');
    return ejecutar<T>(new sql.Request(this.transaccion), texto, valores);
  }

  async commit(): Promise<void> {
    if (this.finalizada) return;
    await this.transaccion.commit();
    this.finalizada = true;
  }

  async rollback(): Promise<void> {
    if (this.finalizada) return;
    await this.transaccion.rollback();
    this.finalizada = true;
  }

  release(): void {
    // `commit`/`rollback` release the dedicated connection back to the pool. A caller that
    // forgot both must not leak it; rollback is intentionally fire-and-forget here because
    // release is used from `finally` blocks that already preserve the original error.
    if (!this.finalizada) void this.rollback().catch(() => undefined);
  }
}

class PoolAzureSql implements Pool {
  constructor(private readonly interno: sql.ConnectionPool) {}

  async query<T = Record<string, unknown>>(
    texto: string,
    valores: readonly unknown[] = [],
  ): Promise<ResultadoConsulta<T>> {
    await this.interno.connect();
    return ejecutar<T>(this.interno.request(), texto, valores);
  }

  async connect(): Promise<PoolClient> {
    await this.interno.connect();
    const transaccion = new sql.Transaction(this.interno);
    await transaccion.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    return new ClienteTransaccion(transaccion);
  }

  async end(): Promise<void> {
    await this.interno.close();
  }
}

export function crearPool(config: ConfiguracionApi): Pool {
  const base = config.baseDeDatos;
  return new PoolAzureSql(
    new sql.ConnectionPool({
      server: base.host,
      port: base.puerto,
      user: base.usuario,
      password: base.contrasena,
      database: base.base,
      pool: {
        max: base.maxConexiones,
        min: 0,
        idleTimeoutMillis: 30_000,
      },
      options: {
        encrypt: true,
        trustServerCertificate: false,
        enableArithAbort: true,
        useUTC: true,
        appName: 'controlhorario-api',
      },
      connectionTimeout: 10_000,
      requestTimeout: 30_000,
    }),
  );
}

/** Runs `fn` in one Azure SQL transaction, rolling back on any throw. */
export async function enTransaccion<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    const resultado = await fn(cliente);
    await cliente.commit();
    return resultado;
  } catch (e: unknown) {
    try {
      await cliente.rollback();
    } catch {
      // The original exception explains the failed operation; a broken connection during
      // rollback is secondary and the pool will discard it.
    }
    throw e;
  } finally {
    cliente.release();
  }
}
