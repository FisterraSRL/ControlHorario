/**
 * The arithmetic behind `Calendario`: which days a month grid shows, how a click turns into
 * a range, where an arrow key moves the focus and what each day says to a screen reader.
 *
 * EVERY DATE IS UTC MIDNIGHT, built with `Date.UTC` and read with `getUTC*`, never with
 * `new Date(y, m, d)` / `getDate()` / `getDay()`. This is Argentina (UTC-3): a local-time
 * midnight is 03:00 UTC of that day, and the moment it is compared with the UTC-midnight
 * dates the rest of the app uses (`src/ui/periodo/periodo.ts`, `src/domain/fichadas/parseo.ts`)
 * every boundary is three hours off — enough for `dentroDelPeriodo` to drop the first day.
 * `grillaMes.test.ts` runs under `America/Argentina/Buenos_Aires` so a local-time slip
 * fails there regardless of the machine running the suite.
 *
 * Self-contained on purpose: the molecule knows nothing about the app's período. The month
 * names are repeated here rather than imported from `periodo.ts` so that a component does
 * not depend on a piece of app state.
 */

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

/** Indexed by `getUTCDay()`: Sunday is 0. */
const DIAS: readonly string[] = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];

/** The grid's column headers, Monday first, as the week runs everywhere else in the app. */
export const COLUMNAS_SEMANA: readonly { readonly corta: string; readonly larga: string }[] = [
  { corta: 'L', larga: 'lunes' },
  { corta: 'M', larga: 'martes' },
  { corta: 'M', larga: 'miércoles' },
  { corta: 'J', larga: 'jueves' },
  { corta: 'V', larga: 'viernes' },
  { corta: 'S', larga: 'sábado' },
  { corta: 'D', larga: 'domingo' },
];

/** A month as the grid addresses it. `mes` is 0-based, like `getUTCMonth()`. */
export interface Mes {
  readonly anio: number;
  readonly mes: number;
}

export interface Rango {
  readonly desde: Date;
  readonly hasta: Date;
}

/** Always six rows: a grid that grew and shrank between months would move the arrows. */
const FILAS = 6;

export function diaUTC(anio: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(anio, mes, dia));
}

export function sumarDias(fecha: Date, dias: number): Date {
  return diaUTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() + dias);
}

export function mismoDia(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

export function mesDe(fecha: Date): Mes {
  return { anio: fecha.getUTCFullYear(), mes: fecha.getUTCMonth() };
}

export function sumarMeses({ anio, mes }: Mes, n: number): Mes {
  const total = anio * 12 + mes + n;
  return { anio: Math.floor(total / 12), mes: ((total % 12) + 12) % 12 };
}

export function esDelMes(fecha: Date, { anio, mes }: Mes): boolean {
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes;
}

/** `2026-09-17`. A stable key and DOM hook, the same format the domain uses for weeks. */
export function claveDia(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Monday 0 … Sunday 6. `getUTCDay()` puts Sunday at 0, which is the trap. */
function columnaDe(fecha: Date): number {
  return (fecha.getUTCDay() + 6) % 7;
}

/**
 * The month as six Monday-to-Sunday rows. The days of the previous and next months that
 * fill the first and last rows are real, selectable dates: a range that crosses a month
 * boundary should not need a trip through the arrows.
 */
export function semanasDelMes(mes: Mes): readonly (readonly Date[])[] {
  const primero = diaUTC(mes.anio, mes.mes, 1);
  const inicio = sumarDias(primero, -columnaDe(primero));
  return Array.from({ length: FILAS }, (_, fila) =>
    Array.from({ length: 7 }, (_, col) => sumarDias(inicio, fila * 7 + col)),
  );
}

export function ordenar(a: Date, b: Date): Rango {
  return a <= b ? { desde: a, hasta: b } : { desde: b, hasta: a };
}

/**
 * What a click does. With nothing pending it sets Desde and waits; with Desde pending it
 * closes the range, swapping the two when the second day is the earlier one.
 */
export type ResultadoClick =
  | { readonly tipo: 'desde'; readonly desde: Date }
  | { readonly tipo: 'completo'; readonly desde: Date; readonly hasta: Date };

export function alElegir(pendiente: Date | null, dia: Date): ResultadoClick {
  if (pendiente === null) return { tipo: 'desde', desde: dia };
  return { tipo: 'completo', ...ordenar(pendiente, dia) };
}

/**
 * The band to paint. While Desde is pending it is the preview between Desde and the day under
 * the pointer (or the keyboard focus), falling back to Desde alone; otherwise it is the range
 * already in force.
 */
export function bandaVisible(actual: Rango, pendiente: Date | null, sobre: Date | null): Rango {
  if (pendiente === null) return actual;
  return ordenar(pendiente, sobre ?? pendiente);
}

export interface EstadoDia {
  readonly inicio: boolean;
  readonly fin: boolean;
  /** Strictly between the ends. */
  readonly medio: boolean;
}

export function estadoDia(fecha: Date, banda: Rango): EstadoDia {
  return {
    inicio: mismoDia(fecha, banda.desde),
    fin: mismoDia(fecha, banda.hasta),
    medio: fecha > banda.desde && fecha < banda.hasta,
  };
}

/**
 * The same day-of-month `n` months away, clamped to that month's length: 31/01 one month on
 * is 28/02, not 03/03. Used both by PageUp/PageDown and by the month arrows.
 */
export function mismoDiaEnOtroMes(fecha: Date, n: number): Date {
  const destino = sumarMeses(mesDe(fecha), n);
  const ultimo = diaUTC(destino.anio, destino.mes + 1, 0).getUTCDate();
  return diaUTC(destino.anio, destino.mes, Math.min(fecha.getUTCDate(), ultimo));
}

/**
 * Where a key moves the focus, following the WAI-ARIA date-picker grid: arrows by day and
 * week, Home/End to the ends of the week, PageUp/PageDown by month and with Shift by year.
 * `null` for any other key, so the caller leaves it alone (Tab, Enter and Space included:
 * Enter and Space are the button's own click).
 */
export function moverFoco(foco: Date, tecla: string, conShift = false): Date | null {
  switch (tecla) {
    case 'ArrowLeft':
      return sumarDias(foco, -1);
    case 'ArrowRight':
      return sumarDias(foco, 1);
    case 'ArrowUp':
      return sumarDias(foco, -7);
    case 'ArrowDown':
      return sumarDias(foco, 7);
    case 'Home':
      return sumarDias(foco, -columnaDe(foco));
    case 'End':
      return sumarDias(foco, 6 - columnaDe(foco));
    case 'PageUp':
      return mismoDiaEnOtroMes(foco, conShift ? -12 : -1);
    case 'PageDown':
      return mismoDiaEnOtroMes(foco, conShift ? 12 : 1);
    default:
      return null;
  }
}

/** `Septiembre 2026` — the caption above the grid. */
export function tituloMes({ anio, mes }: Mes): string {
  const nombre = MESES[mes] ?? '';
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${anio}`;
}

/** `jueves 17 de septiembre de 2026` — the full date a screen reader announces for a day. */
export function etiquetaDia(fecha: Date): string {
  const dia = DIAS[fecha.getUTCDay()] ?? '';
  const mes = MESES[fecha.getUTCMonth()] ?? '';
  return `${dia} ${fecha.getUTCDate()} de ${mes} de ${fecha.getUTCFullYear()}`;
}
