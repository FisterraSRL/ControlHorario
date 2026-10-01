/**
 * The arithmetic behind the Indicador screen, and nothing else: how many faltas, and how
 * many of them were already notified.
 *
 * It does not group anything: `agruparFaltasPorPersona` is the one definition of "faltas per
 * person" and this module only adds up what that function already decided. Keeping the sum
 * here rather than inside the JSX is what makes it testable at all — Vitest only collects
 * `.test.ts` files in a `node` environment, so a `.tsx` test of the screen would never run.
 *
 * Port of the `totals` accumulator inside `renderIndicador` (legacy/app.html ~lines
 * 1272-1284).
 */

import type { TipoFalta } from '../../../domain/fichadas/index.js';
import {
  ORDEN_FALTAS,
  totalDeFaltas,
  type NotificacionPersona,
} from '../../../notificaciones/index.js';
import { contarNotificadas, type IdFaltaNotificada } from '../../faltas/porDia.js';

/** The bottom row of the table: how many faltas of each class the period holds, and the sum. */
export interface TotalesIndicador {
  readonly porTipo: Readonly<Record<TipoFalta, number>>;
  /** Every falta of the period, whatever its class. */
  readonly total: number;
}

/**
 * A zero per falta class.
 *
 * Built by walking `ORDEN_FALTAS` instead of writing the three keys out, so the day the
 * engine grows a fourth class the Indicador counts it without being edited. The assertion is
 * over an object this function fills for every entry of that list on the next line and hands
 * back complete; nothing ever observes it half-built.
 */
function enCero(): Record<TipoFalta, number> {
  const porTipo = {} as Record<TipoFalta, number>;
  for (const tipo of ORDEN_FALTAS) porTipo[tipo] = 0;
  return porTipo;
}

/**
 * Adds the people up.
 *
 * `total` comes from `totalDeFaltas`, the same helper the Notificaciones screen prints per
 * person, rather than from summing `porTipo`: the grand total of the screen and the per-person
 * total of the letter are then the same function, not two that happen to agree today.
 */
export function totalesDelPeriodo(personas: readonly NotificacionPersona[]): TotalesIndicador {
  const porTipo = enCero();
  let total = 0;

  for (const persona of personas) {
    for (const tipo of ORDEN_FALTAS) porTipo[tipo] += persona.faltasPorTipo[tipo].length;
    total += totalDeFaltas(persona.faltasPorTipo);
  }

  return { porTipo, total };
}

/** How many of the period's faltas were already notified, per person and in total. */
export interface NotificadasIndicador {
  /** Keyed by DNI. Every person of `personas` has an entry, zero included. */
  readonly porDni: ReadonlyMap<string, number>;
  readonly total: number;
}

/**
 * Counts, per person, the faltas on screen whose key is in `notificadas`.
 *
 * It does not group or derive anything either: each person's count is `contarNotificadas`
 * over the very rows `totalesDelPeriodo` adds up, so «Notificadas» is on the same scale as
 * «Total faltas» and never exceeds it. It is an INTERSECTION with the faltas that exist now:
 * a key recorded for a falta that a later rule fix erased has no row to land on and is not
 * counted, even though `faltas_notificadas` still holds it as history. The footer's total is
 * the sum of the per-person counts, so the two can never disagree.
 *
 * The notified state is composed here, beside `NotificacionPersona`, and never added to it:
 * that type flows into the pure Word generator, which has no business knowing about it.
 */
export function notificadasDelPeriodo(
  personas: readonly NotificacionPersona[],
  notificadas: ReadonlySet<IdFaltaNotificada>,
): NotificadasIndicador {
  const porDni = new Map<string, number>();
  let total = 0;
  for (const persona of personas) {
    const { notificadas: cuenta } = contarNotificadas(persona, notificadas);
    porDni.set(persona.dni, cuenta);
    total += cuenta;
  }
  return { porDni, total };
}
