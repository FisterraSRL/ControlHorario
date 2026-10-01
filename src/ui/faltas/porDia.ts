/**
 * One person's faltas cut into one notification per calendar day.
 *
 * This is NOT a second grouping. It never sees a `RegistroDia` and never asks the engine
 * anything: it takes one `NotificacionPersona` exactly as `agruparFaltasPorPersona` built it
 * and only redistributes the rows that are already there, so the per-day letters cannot
 * count a falta the per-person letter would not, or format it differently. That invariant
 * (the days add up to the person) is what the tests hold.
 *
 * A day keeps every kind of falta it had together: a day with a tardanza and an exceso de
 * descanso is ONE letter with two sections, because that is one event for the employee and
 * one signature, not two.
 *
 * Pure, like `agrupacion.ts`: no React, no I/O.
 */

import { fmtFechaISO, type TipoFalta } from '../../domain/fichadas/index.js';
import {
  ORDEN_FALTAS,
  type ItemDescanso,
  type ItemFaltaBase,
  type ItemIncompleta,
  type ItemTardanza,
  type NotificacionPersona,
} from '../../notificaciones/index.js';

/** A day with at least one falta, and the notification that covers exactly that day. */
export interface DiaConFaltas {
  /** The QUICKPASS `Fecha` cell every row of `persona` shares, verbatim. Also the day's key. */
  readonly fecha: ItemFaltaBase['fecha'];
  /** Same person, same identity fields, only this day's rows. */
  readonly persona: NotificacionPersona;
}

/** Mutable while the day is being collected. */
interface Acumulador {
  fecha: string;
  fechaOrden: Date | null;
  incompleta: ItemIncompleta[];
  descanso: ItemDescanso[];
  tardanza: ItemTardanza[];
}

/**
 * Chronological, undated days last, then by the raw cell so the order is total.
 *
 * Same "null goes last" rule `agrupacion.ts` applies to rows, for the same reason: the
 * readable part of the list stays in order instead of an unparseable cell floating to the top.
 */
function porFecha(a: Acumulador, b: Acumulador): number {
  if (a.fechaOrden && b.fechaOrden) {
    const diferencia = a.fechaOrden.getTime() - b.fechaOrden.getTime();
    if (diferencia !== 0) return diferencia;
  } else if (a.fechaOrden) {
    return -1;
  } else if (b.fechaOrden) {
    return 1;
  }
  return a.fecha.localeCompare(b.fecha);
}

/**
 * Every day of `persona` that has a falta, oldest first, each as its own notification.
 *
 * The day is keyed by the `fecha` text rather than by `fechaOrden`: the text is what the
 * letter prints and what the ausencias registry already keys a (dni, fecha) by, and an
 * unparseable cell (null `fechaOrden`) still has to land on a day of its own instead of
 * collapsing every undated row into one. Rows keep the order they had inside their bucket,
 * which `agruparFaltasPorPersona` already sorted.
 */
export function separarPorDia(persona: NotificacionPersona): readonly DiaConFaltas[] {
  const dias = new Map<string, Acumulador>();
  const diaDe = (item: ItemFaltaBase): Acumulador => {
    let dia = dias.get(item.fecha);
    if (!dia) {
      dia = { fecha: item.fecha, fechaOrden: item.fechaOrden, incompleta: [], descanso: [], tardanza: [] };
      dias.set(item.fecha, dia);
    }
    return dia;
  };

  // Written out per bucket, like `seccionesDeFaltas`: a loop over `ORDEN_FALTAS` would erase
  // the pairing between each `tipo` and its row type and force a cast.
  for (const item of persona.faltasPorTipo.incompleta) diaDe(item).incompleta.push(item);
  for (const item of persona.faltasPorTipo.descanso) diaDe(item).descanso.push(item);
  for (const item of persona.faltasPorTipo.tardanza) diaDe(item).tardanza.push(item);

  return [...dias.values()].sort(porFecha).map((dia) => ({
    fecha: dia.fecha,
    // Spread keeps usuario/dni/sector and a legajo only when it exists
    // (`exactOptionalPropertyTypes`), then swaps the buckets for this day's.
    persona: {
      ...persona,
      faltasPorTipo: { incompleta: dia.incompleta, descanso: dia.descanso, tardanza: dia.tardanza },
    },
  }));
}

/**
 * One (dni, day, kind of falta) a document covers: the unit "already notified" is recorded in.
 *
 * `fechaIso` is `YYYY-MM-DD`, NOT the QUICKPASS cell. The server stores a SQL `date` and
 * answers ISO; a key built from the raw `14/09/2026` text would never match what comes back,
 * and the Indicador would read zero notified forever. It is derived from the row's
 * `fechaOrden` — the UTC midnight `parsearFechaDMY` produced — with the engine's own
 * `fmtFechaISO`, so no second date parser exists for this.
 */
export interface ClaveNotificada {
  readonly dni: string;
  /** `YYYY-MM-DD`. */
  readonly fechaIso: string;
  readonly tipo: TipoFalta;
}

/** `${dni}|${YYYY-MM-DD}|${tipo}`. The one spelling of a notified key, on every side. */
export type IdFaltaNotificada = string;

export function idFaltaNotificada(dni: string, fechaIso: string, tipo: TipoFalta): IdFaltaNotificada {
  return `${dni}|${fechaIso}|${tipo}`;
}

/**
 * The key one falta row would be recorded under, or `null` when its date never parsed.
 *
 * An unparseable `Fecha` has no calendar day, so it can be neither stored in a `date` column
 * nor matched against one: such a row is simply never "notified". The period filter already
 * drops undated registros, so in practice this only guards the type.
 */
export function idDeFalta(dni: string, item: ItemFaltaBase, tipo: TipoFalta): IdFaltaNotificada | null {
  return item.fechaOrden === null ? null : idFaltaNotificada(dni, fmtFechaISO(item.fechaOrden), tipo);
}

/**
 * The exact (dni, fechaIso, tipo) triples a document for `persona` covers, without repeats,
 * in day order and then `ORDEN_FALTAS` order. Rows without a readable date are skipped (see
 * `idDeFalta`).
 *
 * Computed from the same `NotificacionPersona` the Word is built from, so what is recorded as
 * notified is exactly what the letter printed, never a re-derivation from the screen's state.
 */
export function clavesNotificadas(persona: NotificacionPersona): readonly ClaveNotificada[] {
  const claves: ClaveNotificada[] = [];
  const vistas = new Set<IdFaltaNotificada>();
  for (const { persona: delDia } of separarPorDia(persona)) {
    for (const tipo of ORDEN_FALTAS) {
      for (const item of delDia.faltasPorTipo[tipo]) {
        if (item.fechaOrden === null) continue;
        const fechaIso = fmtFechaISO(item.fechaOrden);
        const id = idFaltaNotificada(persona.dni, fechaIso, tipo);
        if (vistas.has(id)) continue;
        vistas.add(id);
        claves.push({ dni: persona.dni, fechaIso, tipo });
      }
    }
  }
  return claves;
}

/**
 * How many of `persona`'s falta ROWS are already notified, out of how many.
 *
 * Rows and not keys, so the count is on the same scale as `totalDeFaltas`: "3 de 3" means
 * every falta the letter would print, and the notified count can never exceed the total. It
 * is an intersection with the faltas that exist NOW: a key recorded once for a falta that a
 * later rule fix erased is not counted, because there is nothing left on screen it refers to.
 * Both Notificaciones (per day) and Indicador (per person) count through here.
 */
export function contarNotificadas(
  persona: NotificacionPersona,
  notificadas: ReadonlySet<IdFaltaNotificada>,
): { readonly notificadas: number; readonly total: number } {
  let cuenta = 0;
  let total = 0;
  for (const tipo of ORDEN_FALTAS) {
    for (const item of persona.faltasPorTipo[tipo]) {
      total += 1;
      const id = idDeFalta(persona.dni, item, tipo);
      if (id !== null && notificadas.has(id)) cuenta += 1;
    }
  }
  return { notificadas: cuenta, total };
}
