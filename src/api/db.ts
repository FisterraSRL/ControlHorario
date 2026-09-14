/**
 * The connection pool, and the one place a `pg` type is constructed.
 *
 * No SSL: the only client is the `api` container and the only network between them is the
 * private compose bridge. Postgres is published on `127.0.0.1` and never on a routable
 * interface, so there is no path from the LAN, let alone the internet, to port 5432.
 */

import pg from 'pg';
import type { Pool, PoolClient } from 'pg';

export type { Pool, PoolClient };

import type { ConfiguracionApi } from './config.js';

/**
 * `DATE` (OID 1082) must come back as the `YYYY-MM-DD` text Postgres stores, not as a
 * JavaScript `Date`. The default parser builds the Date in the host's LOCAL zone, so in
 * Argentina (UTC-3) `2026-01-05` becomes midnight local and a later `toISOString()` reads
 * `2026-01-04`. That is a fichada silently moving to the previous day — and, on a Monday,
 * to the previous week. The domain layer is careful about exactly this
 * (src/domain/fichadas/parseo.ts, header comment); the driver has to be too.
 */
pg.types.setTypeParser(1082, (valor: string) => valor);

/**
 * `BIGINT` (OID 20) comes back as a string by default because it does not fit a JS number.
 * Every bigint this API reads is a `count(*)` or an identity id far inside
 * `Number.MAX_SAFE_INTEGER`, and leaving them as strings means every call site has to
 * remember to convert. Parsed here, once, with the range actually checked.
 */
pg.types.setTypeParser(20, (valor: string) => {
  const n = Number(valor);
  if (!Number.isSafeInteger(n)) {
    throw new Error('Un BIGINT de la base excede el rango seguro de JavaScript.');
  }
  return n;
});

export function crearPool(config: ConfiguracionApi): Pool {
  return new pg.Pool({
    host: config.baseDeDatos.host,
    port: config.baseDeDatos.puerto,
    user: config.baseDeDatos.usuario,
    password: config.baseDeDatos.contrasena,
    database: config.baseDeDatos.base,
    max: config.baseDeDatos.maxConexiones,
    // Long enough to survive a Postgres restart mid-request, short enough that a wedged
    // network does not hang the upload screen forever.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    application_name: 'controlhorario-api',
  });
}

/** Runs `fn` inside a transaction, rolling back on any throw. */
export async function enTransaccion<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (e: unknown) {
    // A failed ROLLBACK means the connection is already gone; the original error is the one
    // worth propagating, so this one is deliberately swallowed.
    try {
      await cliente.query('ROLLBACK');
    } catch {
      /* the connection is unusable; release() below discards it */
    }
    throw e;
  } finally {
    cliente.release();
  }
}
