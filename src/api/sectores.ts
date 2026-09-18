/**
 * Sector scoping: the one definition of "this row belongs to that account".
 *
 * An `encargado` sees the days of the sectors they supervise and nothing else. THAT IS
 * ENFORCED IN SQL, NOT IN A SCREEN. A filter the browser applies is a filter anybody can
 * remove with the devtools open, and `GET /api/fichadas` returns every DNI in the company —
 * so the scope has to reach the WHERE clause or it does not exist.
 *
 * WHERE THE SECTOR LIVES. Nowhere of its own: the QUICKPASS row is stored whole as JSON in
 * `fichadas.payload`, and the sector is the `Sector` cell. So every scoped query reaches it
 * through `JSON_VALUE([payload], '$.Sector')`, and `ausencias` and `adjuntos` — which have no
 * sector of their own — get there by joining `fichadas` on (dni, fecha).
 *
 * WHY ONE JSON PARAMETER AND NOT AN `IN ($1, $2, $3)`. `parametrizar` in db.ts rewrites
 * `$n` into `@pn` with a regular expression, so a list whose length changes per request
 * would mean building SQL text per request. The same precedent as
 * `repositorioConfiguracion.sembrarExclusiones`: one JSON array parameter, expanded with
 * `OPENJSON`. The `'$.Sector'` inside the JSON path is safe from that rewrite because the
 * regexp only matches a `$` followed by digits.
 *
 * FAIL CLOSED. `null` means unrestricted and is reserved for admin and operador. An empty
 * array is NOT unrestricted: it is an encargado with no sectors assigned, who must see
 * nothing. `OPENJSON('[]')` yields no rows, so the `IN` matches nothing and the query comes
 * back empty — which is the answer that cannot leak.
 */

import type { Consultable } from './db.js';

/** `null` = no restriction (admin, operador). An array = only these sectors. */
export type AlcanceSectores = readonly string[] | null;

/**
 * The predicate that keeps a scoped query inside its sectors.
 *
 * `expresionSector` is the SQL that yields the sector of the row being filtered — usually
 * `JSON_VALUE(f.[payload], '$.Sector')` — and `parametro` is the `$n` index the caller binds
 * `valoresDeAlcance()` to. Written once here so "inside my sectors" cannot come to mean two
 * different things in two repositories.
 */
export function filtroDeSector(expresionSector: string, parametro: number): string {
  return `${expresionSector} IN (SELECT CONVERT(nvarchar(200), [value]) FROM OPENJSON($${parametro}))`;
}

/** The parameter value `filtroDeSector` expects. */
export function valorDeAlcance(alcance: readonly string[]): string {
  return JSON.stringify(alcance);
}

/**
 * The sector of one day, or `null` when there is no evidence for it.
 *
 * `null` covers both "no fichada for this (dni, fecha)" and "the QUICKPASS row has no Sector
 * cell". Neither can be placed inside anybody's scope, and `dentroDelAlcance` refuses both.
 */
export async function sectorDelDia(
  cliente: Consultable,
  dni: string,
  fechaIso: string,
): Promise<string | null> {
  const { rows } = await cliente.query<{ sector: string | null }>(
    `SELECT JSON_VALUE([payload], '$.Sector') AS [sector]
       FROM [controlhorario].[fichadas]
      WHERE [dni] = $1 AND [fecha] = $2`,
    [dni, fechaIso],
  );
  const fila = rows[0];
  if (!fila) return null;
  return fila.sector === null || fila.sector === '' ? null : fila.sector;
}

/** Whether a day of this sector is inside the scope. An unknown sector never is. */
export function dentroDelAlcance(sector: string | null, alcance: AlcanceSectores): boolean {
  if (alcance === null) return true;
  if (sector === null) return false;
  return alcance.includes(sector);
}

/**
 * Whether this account may write to that exact day.
 *
 * The lookup is skipped entirely when the caller is unrestricted, so admin and operador pay
 * nothing for a check whose answer is always yes. A day the caller cannot place — no fichada
 * at all — is refused, which is what makes "the client said so" worthless as an argument.
 */
export async function permiteElDia(
  cliente: Consultable,
  alcance: AlcanceSectores,
  dni: string,
  fechaIso: string,
): Promise<boolean> {
  if (alcance === null) return true;
  return dentroDelAlcance(await sectorDelDia(cliente, dni, fechaIso), alcance);
}
