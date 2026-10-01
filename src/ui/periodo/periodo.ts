/**
 * El período: the day / week / month / year window the screens are read through, or a range
 * of days picked by hand on the header calendar.
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

/** The four windows the segmented control offers. Each one is resolved from a single anchor. */
export type ModoPreset = 'dia' | 'semana' | 'mes' | 'anio';

/**
 * `rango` is the fifth mode: two dates the operator picked on the calendar. It is not a
 * preset, so the segmented control never offers it and shows no segment on while it is on.
 */
export type ModoPeriodo = ModoPreset | 'rango';

export interface PeriodoPreset {
  readonly modo: ModoPreset;
  /** Always UTC midnight. Any date inside the window identifies the window. */
  readonly ancla: Date;
}

export interface PeriodoRango {
  readonly modo: 'rango';
  /** UTC midnight, `desde <= hasta`. Only `crearRango` builds one, so both always hold. */
  readonly desde: Date;
  readonly hasta: Date;
}

/**
 * A discriminated union rather than optional fields on one shape: a preset has an anchor and
 * no explicit ends, a range has explicit ends and no anchor, and every `switch` over `modo`
 * is forced by the compiler to say what it does with each. Optional `desde?`/`hasta?` would
 * have compiled with a forgotten `rango` branch and resolved it as whatever `ancla` happened
 * to hold.
 */
export type Periodo = PeriodoPreset | PeriodoRango;

export interface RangoPeriodo {
  readonly desde: Date;
  readonly hasta: Date;
}

export const MODOS_PERIODO: readonly { readonly modo: ModoPreset; readonly label: string }[] = [
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

/**
 * The only way to build a `Periodo`, so the anchor can never drift off its own window.
 *
 * In `semana` the anchor IS the Monday: the week runs Monday to Sunday, and a header that
 * says "17 sep 2026" above a 14/09 – 20/09 range is naming a day the window does not start
 * on. `dia` keeps the exact day, which is the whole point of that mode, and `mes`/`anio`
 * keep it too — snapping those to the 1st of January would hide which day the operator was
 * actually looking at when they switched modes, and `etiquetaRango` already spells both
 * ends out.
 */
export function crearPeriodo(modo: ModoPreset, ancla: Date): PeriodoPreset {
  return { modo, ancla: modo === 'semana' ? lunesDe(ancla) : ancla };
}

export function periodoInicial(): PeriodoPreset {
  return crearPeriodo('semana', hoyUTC());
}

const MS_DIA = 86_400_000;

/** Drops any time of day. The calendar already hands over UTC midnights; this is the guard. */
function medianocheUTC(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
}

function sumarDias(fecha: Date, dias: number): Date {
  const d = new Date(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}

/**
 * The only way to build a `rango`. The two clicks can come in either order — picking the
 * later day first is a natural thing to do — so they are swapped rather than rejected, and
 * the same day twice is a one-day range.
 */
export function crearRango(a: Date, b: Date): PeriodoRango {
  const x = medianocheUTC(a);
  const y = medianocheUTC(b);
  return x <= y ? { modo: 'rango', desde: x, hasta: y } : { modo: 'rango', desde: y, hasta: x };
}

/**
 * The day a mode switch keeps. From a range it is `desde`: switching to "Mes" after picking
 * 10/09 – 25/10 should show September, the month the operator started reading from.
 */
function anclaDe(periodo: Periodo): Date {
  return periodo.modo === 'rango' ? periodo.desde : periodo.ancla;
}

/** Switches to a preset without losing the place: the new window contains the old anchor. */
export function cambiarModoPeriodo(periodo: Periodo, modo: ModoPreset): PeriodoPreset {
  return crearPeriodo(modo, anclaDe(periodo));
}

/** Inclusive day count of a range: 14/09 – 20/09 is 7, the same day twice is 1. */
function diasDelRango(desde: Date, hasta: Date): number {
  // Rounded rather than truncated as a belt-and-braces measure; between two UTC midnights
  // there is no DST and the difference is always an exact multiple of a day.
  return Math.round((hasta.getTime() - desde.getTime()) / MS_DIA) + 1;
}

/** Inclusive on both ends. The week runs Monday to Sunday, same as the domain engine. */
export function rangoDelPeriodo(periodo: Periodo): RangoPeriodo {
  if (periodo.modo === 'rango') return { desde: periodo.desde, hasta: periodo.hasta };
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

/**
 * Moves one whole window forwards (`1`) or backwards (`-1`). A range moves by its own
 * length, so the arrows page through consecutive, non-overlapping blocks of the same size:
 * 10/09 – 16/09 is followed by 17/09 – 23/09, never by a block that repeats a day.
 */
export function desplazarPeriodo(periodo: PeriodoPreset, direccion: 1 | -1): PeriodoPreset;
export function desplazarPeriodo(periodo: PeriodoRango, direccion: 1 | -1): PeriodoRango;
export function desplazarPeriodo(periodo: Periodo, direccion: 1 | -1): Periodo;
export function desplazarPeriodo(periodo: Periodo, direccion: 1 | -1): Periodo {
  switch (periodo.modo) {
    case 'rango': {
      const paso = direccion * diasDelRango(periodo.desde, periodo.hasta);
      return crearRango(sumarDias(periodo.desde, paso), sumarDias(periodo.hasta, paso));
    }
    case 'dia':
      return crearPeriodo('dia', sumarDias(periodo.ancla, direccion));
    case 'semana':
      return crearPeriodo('semana', sumarDias(periodo.ancla, direccion * 7));
    case 'mes': {
      const a = new Date(periodo.ancla);
      a.setUTCMonth(a.getUTCMonth() + direccion);
      return crearPeriodo('mes', a);
    }
    case 'anio': {
      const a = new Date(periodo.ancla);
      a.setUTCFullYear(a.getUTCFullYear() + direccion);
      return crearPeriodo('anio', a);
    }
  }
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

/**
 * The label on the period button. A preset names its anchor; a range has no anchor and
 * spells both ends, because "17 sep 2026" over a hand-picked range would name one arbitrary
 * day of it.
 */
export function etiquetaPeriodo(periodo: Periodo): string {
  return periodo.modo === 'rango'
    ? etiquetaRango(rangoDelPeriodo(periodo))
    : etiquetaAncla(periodo.ancla);
}

const DOMINGO = 0;
const LUNES = 1;

/**
 * Which ends of the period's window cut a Monday–Sunday week short. `null` when the window
 * starts on a Monday and ends on a Sunday — always the case for the Semana preset.
 *
 * Horas trabajadas groups by whole weeks and compares each against a fixed weekly turno
 * (`reporteSemanal`), so a week the window only half covers shows a "Diferencia" against a
 * turno for days that were never in the window. The screen says so instead of hiding it.
 * When both ends fall in the same week, `primera` and `ultima` are both true and `unica`
 * says it is one week, not two.
 *
 * IT READS THE WINDOW, NOT THE MODE. A hand-picked range is the obvious case, but the Mes
 * preset cuts weeks just the same — October 2026 starts on a Thursday — and so does Día.
 * Keying this on `modo === 'rango'` would warn about the window the user chose and stay
 * silent about the identical one the Mes button produces.
 */
export function semanasParciales(
  periodo: Periodo,
): { readonly primera: boolean; readonly ultima: boolean; readonly unica: boolean } | null {
  const { desde, hasta } = rangoDelPeriodo(periodo);
  const primera = desde.getUTCDay() !== LUNES;
  const ultima = hasta.getUTCDay() !== DOMINGO;
  if (!primera && !ultima) return null;
  const unica = lunesDe(desde).getTime() === lunesDe(hasta).getTime();
  return { primera, ultima, unica };
}
