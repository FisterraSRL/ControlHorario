/**
 * Ordered, checksummed Azure SQL migrations.
 *
 * One database transaction owns an application lock, the DDL and the ledger writes. A
 * second runner waits instead of racing, and a failed migration leaves neither half a
 * schema nor a misleading ledger row behind.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Pool, PoolClient } from './db.js';

const RECURSO_LOCK = 'controlhorario:migraciones:v1';

const SQL_ESQUEMA = `
  IF SCHEMA_ID(N'controlhorario') IS NULL
    EXEC(N'CREATE SCHEMA [controlhorario] AUTHORIZATION [dbo]')
`;

const SQL_TABLA_LEDGER = `
  IF OBJECT_ID(N'[controlhorario].[schema_migrations]', N'U') IS NULL
  BEGIN
    CREATE TABLE [controlhorario].[schema_migrations] (
      [version]     nvarchar(255) NOT NULL,
      [checksum]    char(64)      NOT NULL,
      [aplicada_at] datetime2(3)  NOT NULL
        CONSTRAINT [DF_ch_schema_migrations_at] DEFAULT (SYSUTCDATETIME()),
      [duracion_ms] int           NOT NULL,
      CONSTRAINT [PK_ch_schema_migrations] PRIMARY KEY ([version])
    )
  END
`;

export class ErrorMigracion extends Error {
  override readonly name = 'ErrorMigracion';
}

export interface MigracionAplicada {
  readonly version: string;
  readonly duracionMs: number;
}

export interface ResultadoMigraciones {
  readonly aplicadas: readonly MigracionAplicada[];
  readonly yaEstaban: readonly string[];
  readonly confirmadas: boolean;
}

interface ArchivoMigracion {
  readonly version: string;
  readonly sql: string;
  readonly checksum: string;
}

function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

async function leerArchivos(directorio: string): Promise<readonly ArchivoMigracion[]> {
  let nombres: string[];
  try {
    nombres = await readdir(directorio);
  } catch (e: unknown) {
    throw new ErrorMigracion(
      `No se pudo leer el directorio de migraciones "${directorio}": ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  const sqls = nombres.filter((n) => n.toLowerCase().endsWith('.sql')).sort();
  const malNombrados = sqls.filter((n) => !/^\d{3}_/.test(n));
  if (malNombrados.length > 0) {
    throw new ErrorMigracion(
      `Estas migraciones no empiezan con tres dígitos y un guión bajo: ${malNombrados.join(', ')}.`,
    );
  }

  return Promise.all(
    sqls.map(async (nombre) => {
      const texto = (await readFile(join(directorio, nombre), 'utf8')).replace(/\r\n/g, '\n');
      if (/^\s*GO\s*$/im.test(texto)) {
        throw new ErrorMigracion(
          `${nombre} contiene GO. GO pertenece a sqlcmd/SSMS y no es una sentencia Azure SQL; ` +
            'las migraciones deben ser lotes ejecutables por el driver.',
        );
      }
      return { version: nombre, sql: texto, checksum: sha256(texto) };
    }),
  );
}

async function leerLedger(cliente: PoolClient): Promise<Map<string, string>> {
  const { rows } = await cliente.query<{ version: string; checksum: string }>(
    'SELECT [version], [checksum] FROM [controlhorario].[schema_migrations]',
  );
  return new Map(rows.map((r) => [r.version, r.checksum]));
}

export async function aplicarMigraciones(
  pool: Pool,
  directorio: string,
  opciones: { readonly confirmar?: boolean } = {},
): Promise<ResultadoMigraciones> {
  const archivos = await leerArchivos(directorio);
  if (archivos.length === 0) {
    throw new ErrorMigracion(`No hay ninguna migración en "${directorio}".`);
  }

  const cliente = await pool.connect();
  try {
    const { rows: locks } = await cliente.query<{ resultado: number }>(
      `DECLARE @resultado int;
       EXEC @resultado = sys.sp_getapplock
         @Resource = $1,
         @LockMode = N'Exclusive',
         @LockOwner = N'Transaction',
         @LockTimeout = 10000;
       SELECT @resultado AS resultado;`,
      [RECURSO_LOCK],
    );
    if ((locks[0]?.resultado ?? -999) < 0) {
      throw new ErrorMigracion('No se pudo obtener el lock de migraciones dentro de 10 segundos.');
    }

    await cliente.query(SQL_ESQUEMA);
    await cliente.query(SQL_TABLA_LEDGER);
    const ledger = await leerLedger(cliente);

    for (const archivo of archivos) {
      const previo = ledger.get(archivo.version);
      if (previo !== undefined && previo !== archivo.checksum) {
        throw new ErrorMigracion(
          `${archivo.version} ya fue aplicada pero cambió (base ${previo.slice(0, 12)}, ` +
            `archivo ${archivo.checksum.slice(0, 12)}). Escribí una migración nueva.`,
        );
      }
    }

    const aplicadas: MigracionAplicada[] = [];
    const yaEstaban: string[] = [];
    for (const archivo of archivos) {
      if (ledger.has(archivo.version)) {
        yaEstaban.push(archivo.version);
        continue;
      }

      const inicio = Date.now();
      try {
        await cliente.query(archivo.sql);
      } catch (e: unknown) {
        throw new ErrorMigracion(
          `Falló ${archivo.version}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      const duracionMs = Date.now() - inicio;
      await cliente.query(
        `INSERT INTO [controlhorario].[schema_migrations]
           ([version], [checksum], [duracion_ms]) VALUES ($1, $2, $3)`,
        [archivo.version, archivo.checksum, duracionMs],
      );
      aplicadas.push({ version: archivo.version, duracionMs });
    }

    const confirmar = opciones.confirmar ?? true;
    if (confirmar) await cliente.commit();
    else await cliente.rollback();
    return { aplicadas, yaEstaban, confirmadas: confirmar };
  } catch (e: unknown) {
    try {
      await cliente.rollback();
    } catch {
      // Preserve the migration error; the pool discards a broken transaction connection.
    }
    throw e;
  } finally {
    cliente.release();
  }
}

export async function contarMigracionesAplicadas(pool: Pool): Promise<number | null> {
  try {
    const { rows } = await pool.query<{ n: number }>(
      'SELECT CAST(COUNT_BIG(*) AS int) AS n FROM [controlhorario].[schema_migrations]',
    );
    return rows[0]?.n ?? 0;
  } catch {
    return null;
  }
}
