/**
 * Test doubles for the parts of the API that can be proved without a database.
 *
 * WHY DOUBLES AND NOT A REAL ENGINE. `basePrueba.ts` next to this file runs PGlite, which is
 * PostgreSQL — and this project moved to Azure SQL. Those suites are excluded in
 * `vitest.config.ts` and the T-SQL is verified against the real server with `db:verify`.
 * What is left over, and what these doubles cover, is everything that is a DECISION rather
 * than a dialect: which WHERE clause gets built, which parameter carries the scope, whether
 * the route refused before it wrote, whether both statements ran inside one transaction.
 *
 * A fake pool proves none of the SQL runs. It proves exactly what it records: the text, the
 * values, and the order.
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { Pool, PoolClient, ResultadoConsulta } from '../db.js';
import type { Sesion } from '../sesiones.js';

export interface LlamadaSql {
  readonly texto: string;
  readonly valores: readonly unknown[];
  /** `true` when the statement ran inside a `connect()` transaction. */
  readonly enTransaccion: boolean;
}

/**
 * What a fake answers for one statement. Anything not answered comes back empty.
 *
 * Returning an `Error` makes that statement fail, which is how a test proves that a
 * transaction rolls back instead of leaving half of a write behind.
 */
export type Respondedor = (
  texto: string,
  valores: readonly unknown[],
) => { readonly rows?: readonly unknown[]; readonly rowCount?: number } | Error | undefined;

export interface PoolFalso extends Pool {
  readonly llamadas: readonly LlamadaSql[];
  /** `commit` / `rollback`, in the order they happened. */
  readonly cierres: readonly ('commit' | 'rollback')[];
  /** The text of every statement, joined, for a quick `toContain`. */
  textos(): readonly string[];
}

/**
 * A `Pool` that records instead of executing.
 *
 * `connect()` hands out a client over the same recorder, so a test can assert that two
 * statements shared one transaction and that it was committed rather than rolled back.
 */
export function crearPoolFalso(responder: Respondedor = () => undefined): PoolFalso {
  const llamadas: LlamadaSql[] = [];
  const cierres: ('commit' | 'rollback')[] = [];

  const ejecutar = <T>(
    texto: string,
    valores: readonly unknown[],
    dentro: boolean,
  ): Promise<ResultadoConsulta<T>> => {
    llamadas.push({ texto, valores, enTransaccion: dentro });
    const respuesta = responder(texto, valores);
    if (respuesta instanceof Error) return Promise.reject(respuesta);
    const rows = (respuesta?.rows ?? []) as T[];
    return Promise.resolve({ rows, rowCount: respuesta?.rowCount ?? rows.length });
  };

  const pool: PoolFalso = {
    llamadas,
    cierres,
    textos: () => llamadas.map((l) => l.texto),
    query: <T>(texto: string, valores: readonly unknown[] = []) => ejecutar<T>(texto, valores, false),
    connect(): Promise<PoolClient> {
      const cliente: PoolClient = {
        query: <T>(texto: string, valores: readonly unknown[] = []) =>
          ejecutar<T>(texto, valores, true),
        commit: () => {
          cierres.push('commit');
          return Promise.resolve();
        },
        rollback: () => {
          cierres.push('rollback');
          return Promise.resolve();
        },
        release: () => undefined,
      };
      return Promise.resolve(cliente);
    },
    end: () => Promise.resolve(),
  };
  return pool;
}

/** A session, with the fields a test does not care about already filled in. */
export function sesionDePrueba(parcial: Partial<Sesion> = {}): Sesion {
  return {
    id: 'a'.repeat(64),
    usuarioId: 1,
    email: 'rrhh@ejemplo.test',
    nombre: 'Operadora De Prueba',
    rol: 'operador',
    sectores: [],
    expiraAt: new Date(Date.now() + 3_600_000),
    ...parcial,
  };
}

/**
 * A bare Fastify instance with one session already on every request.
 *
 * The real guard in `autenticacion.ts` is what puts `peticion.sesion` there; here it is set
 * by hand so a route can be exercised for what IT decides, without a login, a cookie or a
 * database. The AJV options are copied from `servidor.ts` because a body schema that
 * silently deletes an unexpected property would make these tests pass for the wrong reason.
 */
export async function appConSesion(
  sesion: Sesion,
  registrar: (app: FastifyInstance) => void,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        useDefaults: false,
        allErrors: false,
        allowUnionTypes: true,
      },
    },
  });
  app.addHook('onRequest', async (peticion) => {
    peticion.sesion = sesion;
  });
  registrar(app);
  await app.ready();
  return app;
}
