/**
 * THE SCHEMA ISOLATION TEST.
 *
 * The database this deploys onto is an Azure Flexible Server shared with two other
 * projects. Everything ControlHorario owns has to be inside the `controlhorario` schema and
 * nothing of ours may be created in `public` — because `public` is where the other two
 * projects' tables live, and `usuarios`, `sesiones`, `configuracion` and `auditoria` are
 * exactly the names an accounts system also uses.
 *
 * WHY A TEST AND NOT A CODE REVIEW. A missing `controlhorario.` in a `CREATE TABLE` produces
 * no error, no warning and no visible difference on a development database: the table is
 * created, the app finds it, every other test passes. It only becomes visible on the shared
 * server, as a collision with somebody else's schema — or, worse, as no collision at all
 * and two applications quietly writing to one table. So it is checked mechanically, against
 * the catalog, after the real migration runner has applied the real files.
 *
 * TWO INDEPENDENT NETS, AND THEY CHECK DIFFERENT THINGS:
 *
 *   1. THIS FILE reads `pg_class` and `pg_namespace` and asserts where the objects ended up.
 *      It catches a DDL statement that forgot its schema.
 *
 *   2. THE HARNESS (`pruebas/basePrueba.ts`) boots every other test with an EMPTY
 *      `search_path`, so a DML statement that forgot its schema cannot resolve and its test
 *      fails. That is why the ~300 assertions elsewhere are also assertions about this rule.
 *      `el search_path de las pruebas` below checks that net is actually in place, because
 *      a harness that quietly started setting `search_path=controlhorario` would make all
 *      of them stop meaning anything.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ESQUEMA } from './db.js';
import { levantarBase, type BaseDePrueba } from './pruebas/basePrueba.js';

let base: BaseDePrueba;

beforeAll(async () => {
  base = await levantarBase();
}, 60_000);

afterAll(async () => {
  await base.cerrar();
});

/**
 * `relkind` covers everything `pg_class` holds: `r` ordinary table, `v` view, `i` index,
 * `S` sequence (identity columns create one), `m` materialised view, `p` partitioned table.
 * Toast tables and indexes are excluded because they are created by Postgres in schemas of
 * its own and say nothing about our DDL.
 */
const SQL_RELACIONES = `
  SELECT n.nspname AS esquema, c.relname AS nombre, c.relkind AS tipo
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg_toast%'
     AND n.nspname NOT LIKE 'pg_temp%'
   ORDER BY n.nspname, c.relname
`;

interface Relacion {
  esquema: string;
  nombre: string;
  tipo: string;
}

async function relaciones(): Promise<readonly Relacion[]> {
  const { rows } = await base.pool.query<Relacion>(SQL_RELACIONES);
  return rows;
}

describe('aislamiento de esquema', () => {
  it('crea el esquema controlhorario', async () => {
    const { rows } = await base.pool.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname = '${ESQUEMA}'`,
    );
    expect(rows.map((r) => r.nspname)).toEqual([ESQUEMA]);
  });

  it('no deja ni una sola tabla, vista, secuencia ni índice nuestro en public', async () => {
    const enPublic = (await relaciones()).filter((r) => r.esquema === 'public');
    // Named in the failure message rather than just counted: if this ever breaks, the first
    // question is "which one", and reading it off the assertion saves opening psql.
    expect(enPublic.map((r) => `${r.tipo} ${r.nombre}`)).toEqual([]);
  });

  it('pone TODAS las relaciones en controlhorario y en ningún otro esquema', async () => {
    const esquemas = [...new Set((await relaciones()).map((r) => r.esquema))];
    expect(esquemas).toEqual([ESQUEMA]);
  });

  it('incluye las tablas que la migración crea y la vista derivada', async () => {
    const tablas = (await relaciones())
      .filter((r) => r.tipo === 'r')
      .map((r) => r.nombre);
    // A spot-check of the three names most likely to collide with an accounts system, plus
    // the evidentiary table this whole project exists for.
    expect(tablas).toEqual(expect.arrayContaining(['usuarios', 'sesiones', 'configuracion', 'fichadas']));

    const vistas = (await relaciones()).filter((r) => r.tipo === 'v').map((r) => r.nombre);
    expect(vistas).toEqual(expect.arrayContaining(['ausencias_pendientes', 'dias_sin_motivo']));
  });

  it('pone el registro de migraciones en controlhorario, no en public', async () => {
    // `schema_migrations` is the one object the RUNNER creates rather than a migration file,
    // so it is the one most easily forgotten — and the name every migration tool on earth
    // uses, which makes a collision in `public` a matter of time.
    const ledger = (await relaciones()).filter((r) => r.nombre === 'schema_migrations');
    expect(ledger.map((r) => r.esquema)).toEqual([ESQUEMA]);
  });

  it('pone los tipos enumerados en controlhorario', async () => {
    const { rows } = await base.pool.query<{ esquema: string; nombre: string }>(`
      SELECT n.nspname AS esquema, t.typname AS nombre
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE t.typtype = 'e'
       ORDER BY t.typname
    `);
    expect(rows).toEqual([
      { esquema: ESQUEMA, nombre: 'motivo_source' },
      { esquema: ESQUEMA, nombre: 'solicitud_estado' },
    ]);
  });

  it('pone la función del trigger en controlhorario, con su propio search_path fijado', async () => {
    const { rows } = await base.pool.query<{
      esquema: string;
      nombre: string;
      config: string[] | null;
    }>(`
      SELECT n.nspname AS esquema, p.proname AS nombre, p.proconfig AS config
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       ORDER BY p.proname
    `);
    expect(rows.map((r) => `${r.esquema}.${r.nombre}`)).toEqual([`${ESQUEMA}.ausencias_rrhh_gana`]);
    // A trigger function inherits the search_path of whoever fired it. Pinned, it cannot be
    // made to resolve a name into another project's schema by a caller who changed theirs.
    expect(rows[0]?.config).toEqual(['search_path=pg_catalog, pg_temp']);
  });
});

describe('el search_path de las pruebas', () => {
  /**
   * These two exist to keep the other test files honest.
   *
   * Every API test runs against a connection whose `search_path` is empty, which is what
   * turns each of them into a check that the statement under it was schema-qualified. If
   * somebody "fixes" the harness by setting `search_path=controlhorario`, nothing would fail
   * — the suite would simply stop testing the thing this whole change is about. So the
   * property is asserted directly.
   */
  it('no tiene controlhorario en el camino de búsqueda', async () => {
    const { rows } = await base.pool.query<{ camino: string }>('SHOW search_path');
    expect(rows[0]?.camino ?? '').not.toContain(ESQUEMA);
  });

  it('hace fallar una referencia sin calificar a una tabla nuestra', async () => {
    // The exact failure a forgotten `controlhorario.` produces in the suite. On the shared
    // Azure server the same statement would NOT fail: it would find the accounts system's
    // `usuarios` instead. That difference is the reason for the empty path.
    await expect(base.pool.query('SELECT id FROM usuarios')).rejects.toThrow(/usuarios/);
  });
});
