/**
 * The migration runner.
 *
 * Applies every `*.sql` in `db/migrations` in filename order, once, and records what it
 * applied in `schema_migrations`. Running it twice does nothing the second time.
 *
 * Three decisions worth knowing before you write `002_*.sql`:
 *
 * 1. **Each file owns its own transaction.** `001_initial.sql` opens with `BEGIN` and ends
 *    with `COMMIT`, and the runner does not wrap it — nesting would make the file's `COMMIT`
 *    close the runner's transaction and leave the ledger write dangling outside it. So every
 *    migration file must be self-contained and transactional the same way 001 is. A file
 *    that half-applies because it forgot `BEGIN` is the file's bug, not the runner's.
 *
 * 2. **The ledger row is written immediately after the file commits, as a separate
 *    statement.** There is therefore a window — one round trip wide — where a migration is
 *    applied but unrecorded. If the process dies exactly there, the next run replays the
 *    file and fails loudly on the re-created type or table rather than quietly doing damage.
 *    docs/servidor.md has the two-line recovery. Closing the window entirely would mean
 *    concatenating the ledger INSERT into the same string as the migration, which means
 *    building SQL by string concatenation — and this codebase does not do that anywhere.
 *
 * 3. **Checksums are verified, not just recorded.** An already-applied file whose bytes
 *    changed is a hard startup failure. `001_initial.sql` is the schema of an evidentiary
 *    record; editing it after it has been applied somewhere means the database on the
 *    Fisterra machine and the file in git no longer describe the same thing, and nothing
 *    else would ever tell you.
 *
 * An advisory lock serialises concurrent runners, so an accidental second `api` container
 * waits instead of racing.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Pool, PoolClient } from './db.js';

/** Arbitrary but fixed: `pg_advisory_lock` needs a number nobody else in this DB uses. */
const LLAVE_LOCK = 8_141_973;

const SQL_TABLA_LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    aplicada_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    duracion_ms INTEGER NOT NULL
  )
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
}

interface ArchivoMigracion {
  readonly version: string;
  readonly ruta: string;
  readonly sql: string;
  readonly checksum: string;
}

function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

/**
 * Filename order, byte-wise. `001_`, `002_`, `010_` sort correctly because the prefixes are
 * zero-padded; an unpadded `10_foo.sql` would sort before `2_foo.sql`, so the runner refuses
 * a name that does not start with three digits rather than applying them out of order.
 */
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
      `Estas migraciones no empiezan con tres dígitos y un guión bajo, así que su orden de ` +
        `aplicación sería ambiguo: ${malNombrados.join(', ')}.`,
    );
  }

  const archivos: ArchivoMigracion[] = [];
  for (const nombre of sqls) {
    const ruta = join(directorio, nombre);
    // Normalised to LF before hashing: the repo has a .gitattributes, but a checkout on
    // Windows with autocrlf on would otherwise produce a different checksum for identical
    // SQL and fail the integrity check for no reason.
    const sql = (await readFile(ruta, 'utf8')).replace(/\r\n/g, '\n');
    archivos.push({ version: nombre, ruta, sql, checksum: sha256(sql) });
  }
  return archivos;
}

async function leerLedger(cliente: PoolClient): Promise<Map<string, string>> {
  const { rows } = await cliente.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations',
  );
  return new Map(rows.map((r) => [r.version, r.checksum]));
}

/**
 * Applies whatever is pending. Idempotent: with nothing pending it does two cheap queries
 * and returns.
 */
export async function aplicarMigraciones(
  pool: Pool,
  directorio: string,
): Promise<ResultadoMigraciones> {
  const archivos = await leerArchivos(directorio);
  if (archivos.length === 0) {
    throw new ErrorMigracion(`No hay ninguna migración en "${directorio}".`);
  }

  const cliente = await pool.connect();
  try {
    await cliente.query('SELECT pg_advisory_lock($1)', [LLAVE_LOCK]);
    await cliente.query(SQL_TABLA_LEDGER);

    const ledger = await leerLedger(cliente);

    for (const archivo of archivos) {
      const checksumPrevio = ledger.get(archivo.version);
      if (checksumPrevio !== undefined && checksumPrevio !== archivo.checksum) {
        throw new ErrorMigracion(
          `${archivo.version} ya fue aplicada en esta base, pero el archivo cambió desde ` +
            `entonces (checksum ${checksumPrevio.slice(0, 12)} en la base, ` +
            `${archivo.checksum.slice(0, 12)} en disco). La base y el repositorio dejaron de ` +
            `describir el mismo esquema. No se aplica nada. Revertí el archivo, o escribí una ` +
            `migración nueva con el cambio.`,
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
        // Simple query protocol: the file may contain many statements and its own
        // BEGIN/COMMIT. No parameters are involved, so nothing here is interpolated.
        await cliente.query(archivo.sql);
      } catch (e: unknown) {
        throw new ErrorMigracion(
          `Falló ${archivo.version}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      const duracionMs = Date.now() - inicio;
      await cliente.query(
        'INSERT INTO schema_migrations (version, checksum, duracion_ms) VALUES ($1, $2, $3)',
        [archivo.version, archivo.checksum, duracionMs],
      );
      aplicadas.push({ version: archivo.version, duracionMs });
    }

    return { aplicadas, yaEstaban };
  } finally {
    try {
      await cliente.query('SELECT pg_advisory_unlock($1)', [LLAVE_LOCK]);
    } catch {
      /* the session is ending anyway; the lock dies with the connection */
    }
    cliente.release();
  }
}

/** How many migrations this database has on record. Used by `/health`. */
export async function contarMigracionesAplicadas(pool: Pool): Promise<number | null> {
  try {
    const { rows } = await pool.query<{ n: number }>(
      'SELECT count(*)::bigint AS n FROM schema_migrations',
    );
    return rows[0]?.n ?? 0;
  } catch {
    // The table does not exist yet, which is a fact about the database, not an error.
    return null;
  }
}
