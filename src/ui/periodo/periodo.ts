/**
 * El período: the day / week / month / year window the screens are read through.
 *
 * Pure functions over plain data, like the domain engine — no React, no storage. The only
 * stateful part lives in `PeriodoProvider`.
 *
 * Every date here is UTC, for the same reason `src/domain/fichadas/parseo.ts` is: the
 * QUICKPASS export carries plain calendar dates with no zone, and comparing them against a
 * locally-constructed Date would shift a fichada into the previous day west of Greenwich.
 * The one place the local clock is read is `hoyUTC()`, which takes the operator's local
 * calendar date and re-expresses it at UTC midnight — the legacy file used a raw
 * `new Date()` as the anchor, which carries a time-of-day and makes the anchor's UTC date
 * differ from the operator's own date for part of every evening in Argentina (UTC-3).
 */

import { domingoDe, fmtFechaAR, lunesDe } from '../../domain/fichadas/index.js';

export type ModoPeriodo = 'dia' | 'semana' | 'mes' | 'anio';

export interface Periodo {
  readonly modo: ModoPeriodo;
  /** Always UTC midnight. Any date inside the window identifies the window. */
  readonly ancla: Date;
}

export interface RangoPeriodo {
  readonly desde: Date;
  readonly hasta: Date;
}

export const MODOS_PERIODO: readonly { readonly modo: ModoPeriodo; readonly label: string }[] = [
  { modo: 'dia', label: 'Día' },
  { modo: 'semana', label: 'Semana' },
  { modo: 'mes', label: 'Mes' },
  { modo: 'anio', label: 'Año' },
];

const MESES: readonly string[] = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Today's *local* calendar date, re-expressed at UTC midnight. */
export function hoyUTC(): Date {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()));
}

export function periodoInicial(): Periodo {
  return { modo: 'semana', ancla: hoyUTC() };
}

/** Inclusive on both ends. The week runs Monday to Sunday, same as the domain engine. */
export function rangoDelPeriodo(periodo: Periodo): RangoPeriodo {
  const a = periodo.ancla;
  switch (periodo.modo) {
    case 'dia': {
      const d = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()));
      return { desde: d, hasta: d };
    }
    case 'semana':
      return { desde: lunesDe(a), hasta: domingoDe(a) };
    case 'mes':
      return {
        desde: new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1)),
        hasta: new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 0)),
      };
    case 'anio':
      return {
        desde: new Date(Date.UTC(a.getUTCFullYear(), 0, 1)),
        hasta: new Date(Date.UTC(a.getUTCFullYear(), 11, 31)),
      };
  }
}

/** Moves the anchor one whole window forwards (`1`) or backwards (`-1`). */
export function desplazarPeriodo(periodo: Periodo, direccion: 1 | -1): Periodo {
  const a = new Date(periodo.ancla);
  switch (periodo.modo) {
    case 'dia':
      a.setUTCDate(a.getUTCDate() + direccion);
      break;
    case 'semana':
      a.setUTCDate(a.getUTCDate() + direccion * 7);
      break;
    case 'mes':
      a.setUTCMonth(a.getUTCMonth() + direccion);
      break;
    case 'anio':
      a.setUTCFullYear(a.getUTCFullYear() + direccion);
      break;
  }
  return { modo: periodo.modo, ancla: a };
}

/** A row with no parseable `Fecha` belongs to no period and is never counted in one. */
export function dentroDelPeriodo(fecha: Date | null, rango: RangoPeriodo): boolean {
  if (!fecha) return false;
  return fecha >= rango.desde && fecha <= rango.hasta;
}

/** `14/09/2026 – 20/09/2026`. An en dash, not a hyphen: this is prose, not a range operator. */
export function etiquetaRango(rango: RangoPeriodo): string {
  if (rango.desde.getTime() === rango.hasta.getTime()) return fmtFechaAR(rango.desde);
  return `${fmtFechaAR(rango.desde)} – ${fmtFechaAR(rango.hasta)}`;
}

/** `14 sep 2026` — the compact anchor label on the period button. */
export function etiquetaAncla(ancla: Date): string {
  const mes = MESES[ancla.getUTCMonth()] ?? '';
  return `${String(ancla.getUTCDate()).padStart(2, '0')} ${mes.slice(0, 3)} ${ancla.getUTCFullYear()}`;
}
