/**
 * The test harness: a real Postgres and the real Fastify app, with no Docker.
 *
 * WHY THIS EXISTS. Docker does not start in the environment this code is developed in, and
 * the parts of this slice most worth testing are exactly the parts that only exist in
 * Postgres: the `ausencias_motivo_con_origen` CHECK, the `ausencias_rrhh_gana` trigger, the
 * `ON CONFLICT ... WHERE` that protects a human's motivo from a re-upload, the enum casts,
 * the foreign keys that cascade a `DELETE FROM fichadas` into the registry. A fake
 * repository proves none of it — it proves that the fake agrees with itself.
 *
 * So the tests run against PGlite: Postgres itself, compiled to WebAssembly, in-process. It
 * is the same query planner, the same type system, the same constraint machinery, reading
 * `db/migrations/*.sql` through the same migration runner `main.ts` uses at boot.
 *
 * WHAT IT IS NOT. PGlite is a single connection and a single backend process. It cannot
 * show a lock contention bug, a `pg_advisory_lock` race between two `api` containers, or
 * anything about connection pooling. Those are real gaps and they are the reason
 * `docs/stack-local.md` still says to check `/health` after a deploy.
 *
 * THE SHIM BELOW IS THE ONLY ADAPTATION, and it is deliberately thin:
 *
 *   * `query(texto)` with no parameters goes to `exec`, because the migration runner hands
 *     over a whole file with its own BEGIN/COMMIT and `query` takes one statement;
 *   * the DATE parser is re-applied, because `db.ts` installs it on the `pg` driver and
 *     PGlite is not that driver. Without it `2026-01-05` comes back as a Date built in the
 *     host's local zone and, in Argentina, reads back as the 4th;
 *   * `connect()` serialises. There is one connection underneath, so two overlapping
 *     transactions would interleave their statements into one another. Real Postgres gives
 *     each `connect()` its own backend; here the second caller waits.
 */

import { mkdtemp, readdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import type { FastifyInstance } from 'fastify';

import { leerConfiguracion, type ConfiguracionApi } from '../config.js';
import type { Pool, PoolClient } from '../db.js';
import { aplicarMigraciones } from '../migraciones.js';
import { crearLimitadorLogin, type LimitesLogin } from '../limitador.js';
import { construirServidor } from '../servidor.js';

/**
 * OID 1082 is DATE. See the header of `db.ts`: the default parser builds a JavaScript Date
 * at local midnight, which west of Greenwich is the previous calendar day.
 */
const PARSERS = { 1082: (valor: string) => valor } as const;

interface Resultado<T> {
  readonly rows: T[];
  readonly rowCount: number;
}

async function ejecutar<T>(db: PGlite, texto: string, valores?: unknown[]): Promise<Resultado<T>> {
  if (valores === undefined) {
    const resultados = await db.exec(texto, { parsers: PARSERS });
    const ultimo = resultados[resultados.length - 1];
    return {
      rows: (ultimo?.rows ?? []) as T[],
      rowCount: ultimo?.rowCount ?? ultimo?.affectedRows ?? 0,
    };
  }
  const r = await db.query<T>(texto, valores, { parsers: PARSERS });
  return { rows: r.rows, rowCount: r.rowCount ?? r.affectedRows ?? 0 };
}

/** A `Pool` over one PGlite instance, with `connect()` handing out an exclusive client. */
function comoPool(db: PGlite): Pool {
  let cola: Promise<void> = Promise.resolve();

  const pool = {
    query: <T>(texto: string, valores?: unknown[]) => ejecutar<T>(db, texto, valores),
    async connect(): Promise<PoolClient> {
      const anterior = cola;
      let liberar: () => void = () => undefined;
      cola = new Promise<void>((r) => {
        liberar = r;
      });
      await anterior;
      let liberado = false;
      return {
        query: <T>(texto: string, valores?: unknown[]) => ejecutar<T>(db, texto, valores),
        release() {
          if (liberado) return;
          liberado = true;
          liberar();
        },
      } as unknown as PoolClient;
    },
    async end() {
      await db.close();
    },
  };
  return pool as unknown as Pool;
}

export interface BaseDePrueba {
  readonly pool: Pool;
  readonly app: FastifyInstance;
  readonly config: ConfiguracionApi;
  /** Directory the attachments were written to. Removed by `cerrar`. */
  readonly dirAdjuntos: string;
  cerrar(): Promise<void>;
}

export interface OpcionesBase {
  /** Tightened by the rate-limit test so it does not have to send sixty requests. */
  readonly limitesLogin?: LimitesLogin;
  /**
   * Extra routes, registered AFTER the session guard and before `ready()`.
   *
   * This is how the fail-closed test adds a route nobody protected: Fastify refuses new
   * routes once the instance is ready, so proving "a route added later is denied by
   * default" has to happen inside the same window a real developer's route would.
   */
  readonly rutasExtra?: (app: FastifyInstance) => void;
  /** Routes registered before the guard exists. See `OpcionesServidor`. */
  readonly rutasAntes?: (app: FastifyInstance) => void;
  /**
   * Extra environment, applied before `leerConfiguracion` runs and undone by `cerrar`.
   *
   * It exists for the cross-origin tests: the whole point of `origenCruzado.test.ts` is to
   * boot a server configured the way the Vercel deployment configures it —
   * `APP_ORIGEN_FRONTEND` set, `API_COOKIE_SEGURA=true` — and assert on the headers that
   * come out. Reaching into `config` afterwards would test a hand-made object instead of
   * the real `leerConfiguracion`, which is exactly the boot-time validation worth covering.
   */
  readonly entorno?: Readonly<Record<string, string>>;
}

/**
 * Everything a test may have written, emptied.
 *
 * Cheaper than a fresh PGlite per test by about a second each, and it keeps the seeded rows
 * of migration 002 — `configuracion`, `sector_reglas`, `motivos` — at exactly the values the
 * migration left, which is the state a real server boots into.
 */
const TABLAS_DE_DATOS = [
  'controlhorario.auditoria',
  'controlhorario.sesiones',
  'controlhorario.usuarios',
  'controlhorario.adjuntos',
  'controlhorario.ausencias',
  'controlhorario.fichadas',
  'controlhorario.cargas',
  'controlhorario.exclusiones',
  'controlhorario.exclusiones_semilla',
  'controlhorario.empleados',
] as const;

export async function reiniciarDatos(base: BaseDePrueba): Promise<void> {
  // The attachment directory is state too. Left behind, a file written by one test makes
  // the next one's "nothing was written to disk" assertion pass or fail for the wrong reason.
  for (const archivo of await readdir(base.dirAdjuntos)) {
    await unlink(join(base.dirAdjuntos, archivo));
  }
  await base.pool.query(
    `TRUNCATE ${TABLAS_DE_DATOS.join(', ')} RESTART IDENTITY CASCADE`,
  );
  // The three seeded tables are restored rather than truncated: their content is part of
  // the schema, not of any test.
  await base.pool.query(`
    DELETE FROM controlhorario.sector_reglas;
    INSERT INTO controlhorario.sector_reglas (sector, fichadas_requeridas)
      VALUES ('Reparto', 2), ('Cocina', 2), ('Administración', 2);
    UPDATE controlhorario.configuracion SET valor = '30'::jsonb WHERE clave = 'descanso_max_min';
    UPDATE controlhorario.configuracion SET valor = '0'::jsonb  WHERE clave = 'tolerancia_min';
    UPDATE controlhorario.configuracion SET valor = '51'::jsonb WHERE clave = 'horas_turno_semanales';
    DELETE FROM controlhorario.motivos WHERE id > 9;
    UPDATE controlhorario.motivos SET activo = TRUE;
    UPDATE controlhorario.motivos SET worked = (id IN (4, 5, 6, 7, 8));
  `);
}

/**
 * A fresh database, migrated, with the real server on top of it.
 *
 * The environment is set here rather than in a `.env`: `leerConfiguracion` is the real
 * function and it reads `process.env`, so this also proves that a server configured the way
 * `docker-compose.yml` configures it actually boots.
 */
export async function levantarBase(opciones: OpcionesBase = {}): Promise<BaseDePrueba> {
  const dirAdjuntos = await mkdtemp(join(tmpdir(), 'controlhorario-adjuntos-'));

  process.env['PGUSER'] = 'prueba';
  process.env['PGPASSWORD'] = 'prueba';
  process.env['PGDATABASE'] = 'prueba';
  process.env['API_DIR_ADJUNTOS'] = dirAdjuntos;
  // A Secure cookie is never stored by a client speaking plain HTTP, and `app.inject` is
  // plain HTTP. Production defaults to true; see config.ts.
  process.env['API_COOKIE_SEGURA'] = 'false';
  process.env['API_NIVEL_LOG'] = 'silent';
  process.env['APP_URL_PUBLICA'] = '';
  delete process.env['EXCLUSIONES_INICIALES'];
  // Default: no cross-origin frontend, which is the local stack. `origenCruzado.test.ts`
  // overrides both of these through `opciones.entorno` to boot the Vercel shape instead.
  delete process.env['APP_ORIGEN_FRONTEND'];
  delete process.env['API_COOKIE_SAMESITE'];

  // Snapshotted so one test file cannot change the configuration another one boots with.
  const entornoPrevio = new Map<string, string | undefined>();
  for (const [clave, valor] of Object.entries(opciones.entorno ?? {})) {
    entornoPrevio.set(clave, process.env[clave]);
    process.env[clave] = valor;
  }
  const restaurarEntorno = (): void => {
    for (const [clave, valor] of entornoPrevio) {
      if (valor === undefined) delete process.env[clave];
      else process.env[clave] = valor;
    }
  };

  let config: ConfiguracionApi;
  try {
    config = leerConfiguracion(resolve(process.cwd()));
  } catch (e: unknown) {
    restaurarEntorno();
    await rm(dirAdjuntos, { recursive: true, force: true });
    throw e;
  }
  const db = new PGlite();
  await db.waitReady;
  const pool = comoPool(db);

  /**
   * THE `search_path` IS SET TO THE WRONG THING ON PURPOSE, AND THIS IS THE POINT.
   *
   * Production sets `search_path=controlhorario` on every connection (see `crearPool` in
   * `db.ts`). If the harness did the same, an unqualified `SELECT ... FROM usuarios` that
   * somebody adds next month would resolve, the suite would pass, and the mistake would
   * only surface on the shared Azure server — where `usuarios` is also a table belonging to
   * the accounts system for two other projects, so it would not fail there either. It would
   * read, or write, the wrong company's data.
   *
   * So here the path deliberately does NOT contain `controlhorario`. Anything that is not
   * written `controlhorario.<name>` fails with `relation ... does not exist`, in CI, on the
   * first run. That makes every one of the ~300 tests below a check on the rule, instead of
   * needing one test that tries to remember every statement.
   *
   * `pg_catalog` and `pg_temp` are still searched — PostgreSQL searches both whether or not
   * they are named — which is what keeps `pg_advisory_lock` and the `ausencias_vigentes`
   * temp table of `repositorioAusencias.ts` working.
   */
  await db.exec("SET search_path TO ''");

  await aplicarMigraciones(pool, config.directorioMigraciones);

  const app = await construirServidor(config, pool, {
    ...(opciones.limitesLogin ? { limitador: crearLimitadorLogin(opciones.limitesLogin) } : {}),
    ...(opciones.rutasAntes ? { rutasAntesDelGuardia: opciones.rutasAntes } : {}),
  });
  opciones.rutasExtra?.(app);
  await app.ready();

  return {
    pool,
    app,
    config,
    dirAdjuntos,
    async cerrar() {
      restaurarEntorno();
      await app.close();
      await db.close();
      await rm(dirAdjuntos, { recursive: true, force: true });
    },
  };
}
