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

import type { TipoFalta } from '../../domain/fichadas/index.js';
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

/** What one notification covers, as the next unit will persist it. */
export interface ClaveNotificada {
  readonly dni: string;
  readonly fecha: string;
  readonly tipo: TipoFalta;
}

/**
 * The exact (dni, fecha, tipo) triples a document for `persona` covers, without repeats,
 * in day order and then `ORDEN_FALTAS` order.
 *
 * Not used yet. It exists so the unit that records "already notified" has one definition of
 * what a document covers, computed from the same `NotificacionPersona` the Word is built from,
 * instead of re-deriving it from the screen's state.
 */
export function clavesNotificadas(persona: NotificacionPersona): readonly ClaveNotificada[] {
  const claves: ClaveNotificada[] = [];
  for (const { fecha, persona: delDia } of separarPorDia(persona)) {
    for (const tipo of ORDEN_FALTAS) {
      if (delDia.faltasPorTipo[tipo].length > 0) claves.push({ dni: persona.dni, fecha, tipo });
    }
  }
  return claves;
}
