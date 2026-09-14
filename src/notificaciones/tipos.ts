/**
 * Shapes the notificaciones module takes in and hands back.
 *
 * The vocabulary is Spanish for the same reason the fichadas engine's is: `notificacion`,
 * `falta`, `persona`, `sector` and `turno` are the words the business uses. Structural
 * names (the OOXML builders, the density, the options bags) stay in English.
 *
 * Nothing here re-declares a domain concept. Every field that comes out of the fichadas
 * engine is typed by indexing the engine's own types, so a change to `RegistroDia` or
 * `Falta` shows up here as a type error instead of as silent drift.
 *
 * Legacy provenance (legacy/app.html): the per-fault item objects are built by
 * `groupFaultsByPerson` (~lines 1154-1184), which is UI-layer grouping and deliberately
 * NOT part of this module. Field mapping, legacy -> here:
 *   fecha   -> fecha        detail  -> detalle
 *   dateObj -> fechaOrden   turnoRaw -> turnoRaw
 *   byType  -> faltasPorTipo
 */

import type { Falta, RegistroDia, TipoFalta } from '../domain/fichadas/tipos.js';

/**
 * What every notification row carries, whatever the falta is.
 *
 * All four values are already-formatted text by the time they get here: the module prints
 * them, it never re-formats or re-computes them. That is deliberate — the numbers in a
 * disciplinary letter must be the same numbers the operator saw on screen before pressing
 * the button.
 */
export interface ItemFaltaBase {
  /** `RegistroDia.fechaStr` verbatim — the QUICKPASS `Fecha` cell, printed as-is. */
  readonly fecha: RegistroDia['fechaStr'];
  /** `RegistroDia.turnoRaw`. An empty value prints as the em dash placeholder. */
  readonly turnoRaw: RegistroDia['turnoRaw'];
  /**
   * `RegistroDia.fecha` — the sort key of the table, never printed. Null (an unparseable
   * `Fecha` cell) sorts as the epoch, which is what the legacy's `a.dateObj - b.dateObj`
   * did once `null` coerced to 0.
   */
  readonly fechaOrden: RegistroDia['fecha'];
  /**
   * `Falta.detalle`, the on-screen summary. Carried for traceability only: the Word tables
   * print the columns below, never this. Optional because the generator does not need it.
   */
  readonly detalle?: Falta['detalle'];
}

/** A row of the Fichadas Incompletas table. */
export interface ItemIncompleta extends ItemFaltaBase {
  /** The punches actually registered, e.g. `08:02 - 12:10 - 17:55`, or the em dash. */
  readonly registradas: string;
  /** `N de M`, or the "Olvidó fichar" note when QUICKPASS is the only reason. */
  readonly cantidad: string;
}

/** A row of the Exceso de Descanso table. */
export interface ItemDescanso extends ItemFaltaBase {
  /** The break actually taken, as `H:MM`. */
  readonly descansoTomado: string;
  /** How much of it went over the allowance, as `H:MM`. */
  readonly exceso: string;
}

/** A row of the Llegadas Tarde table. */
export interface ItemTardanza extends ItemFaltaBase {
  /** The first punch of the day, as `HH:MM`, or the em dash when there was none. */
  readonly horarioFichado: string;
  /** How late that punch was, as `H:MM`. */
  readonly minutos: string;
}

/**
 * Which row shape belongs to which `TipoFalta`. Keeping the pairing in one place is what
 * lets `SeccionDeFaltas` stay a real discriminated union instead of a bag of casts.
 */
export interface ItemsPorTipo {
  readonly incompleta: ItemIncompleta;
  readonly descanso: ItemDescanso;
  readonly tardanza: ItemTardanza;
}

/** Any notification row, whatever its falta. */
export type ItemFalta = ItemsPorTipo[TipoFalta];

/** One person's faltas for the period, bucketed by type. Legacy `byType`. */
export type FaltasPorTipo = {
  readonly [T in TipoFalta]: readonly ItemsPorTipo[T][];
};

/**
 * A `tipo` and the rows that belong to it, kept together so narrowing on `tipo` also
 * narrows the rows. This is the unit `buildTablaDeFaltas` renders.
 */
export type SeccionDeFaltas = {
  [T in TipoFalta]: { readonly tipo: T; readonly items: readonly ItemsPorTipo[T][] };
}[TipoFalta];

/**
 * Everything one notification page needs about the person it is addressed to.
 *
 * The legacy group object also carried `total` (the sum of the three bucket lengths) and
 * `legajo`. `total` is derived here instead of trusted, so it cannot disagree with the
 * buckets; `legajo` is accepted but never printed, so a caller can pass its existing group
 * object straight through.
 */
export interface NotificacionPersona {
  /** Printed after `Sr./Sra. `. */
  readonly usuario: RegistroDia['usuario'];
  /** Printed after `CUIL: `. The QUICKPASS `DNI` column, which is what the letter calls CUIL. */
  readonly dni: RegistroDia['dni'];
  /** Printed after `Sector: `. */
  readonly sector: RegistroDia['sector'];
  readonly faltasPorTipo: FaltasPorTipo;
  /** Accepted for caller convenience; the notification never prints it. */
  readonly legajo?: RegistroDia['legajo'];
}

/**
 * Font sizes (half-points), spacing scale and table row padding (twips) for one letter.
 * Every one of them shrinks together as a person's fault count grows so the page stays a
 * single page. Legacy `CUR_DENSITY` — a module-level mutable global there, an explicit
 * argument here.
 */
export interface Densidad {
  /** Body run size, in half-points. */
  readonly body: number;
  /** Heading run size, in half-points. */
  readonly heading: number;
  /** Fault-section subtitle size, in half-points. */
  readonly sub: number;
  /** Table cell run size, in half-points. */
  readonly table: number;
  /** Multiplier applied to every spacing constant by `sp`. */
  readonly spacingScale: number;
  /** Vertical table cell padding, in twips. */
  readonly cellPadV: number;
}

/**
 * A finished `.docx`, as bytes plus the name the legacy would have saved it under.
 *
 * `Uint8Array` rather than `Blob` on purpose: it is the one binary container both runtimes
 * take without conversion. The browser wraps it at the download call site
 * (`new Blob([bytes], { type: MIME_DOCX })`), which is UI code anyway; Node writes it
 * straight to disk or hands it to a Fastify reply. A `Blob` would force the server side to
 * go through the async `arrayBuffer()` just to get the bytes back out.
 */
export interface DocumentoGenerado {
  readonly nombreArchivo: string;
  readonly bytes: Uint8Array;
}

/** Options shared by everything that stamps today's date onto a document. */
export interface OpcionesNotificacion {
  /**
   * The date the letter is dated with. Defaults to `new Date()`, which is what the legacy
   * did; pass it to make generation deterministic (and to test it).
   */
  readonly hoy?: Date;
}
