/**
 * Parsing and formatting of the QUICKPASS cell formats.
 *
 * Every date here is UTC (`Date.UTC`, `getUTC*`, `toISOString`). The export carries plain
 * calendar dates with no zone, so letting the host's local zone in would shift a fichada to
 * the previous day west of Greenwich and silently move it to another week. Never introduce
 * `new Date(y, m, d)` or `getDay()` in this file.
 */

import type { InfoTurno, ValorCelda } from './tipos.js';

/** Reproduces the legacy `row['X'] || ''`: any falsy cell becomes the empty string. */
export function celdaTexto(valor: ValorCelda): string {
  return valor ? String(valor) : '';
}

/**
 * `"H:MM"` to minutes. Negative values are real: QUICKPASS reports an early departure or an
 * hours deficit as `"-1:30"`. Empty and `'-'` mean "nothing to report", not zero minutes
 * worked — both collapse to 0. Anything unparseable is 0 as well, never NaN.
 */
export function parsearHM(valor: ValorCelda): number {
  if (valor === undefined || valor === null) return 0;
  const s = String(valor).trim();
  if (s === '' || s === '-') return 0;
  const negativo = s.charAt(0) === '-';
  const limpio = negativo ? s.slice(1) : s;
  const m = limpio.match(/^(\d+):(\d{2})$/);
  if (!m) return 0;
  const valorMin = parseInt(m[1] as string, 10) * 60 + parseInt(m[2] as string, 10);
  return negativo ? -valorMin : valorMin;
}

/** `"DD/MM/YYYY"` to a UTC-midnight Date. Null when the cell is not that exact format. */
export function parsearFechaDMY(valor: ValorCelda): Date | null {
  const m = celdaTexto(valor)
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Date.UTC(+(m[3] as string), +(m[2] as string) - 1, +(m[1] as string)));
}

/** Monday of the week containing `fecha`. The week runs Monday to Sunday. */
export function lunesDe(fecha: Date): Date {
  const d = new Date(fecha);
  const dia = d.getUTCDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

/** Sunday of the week containing `fecha`. */
export function domingoDe(fecha: Date): Date {
  const d = new Date(lunesDe(fecha));
  d.setUTCDate(d.getUTCDate() + 6);
  return d;
}

/** `YYYY-MM-DD`, the key format used for a week. */
export function fmtFechaISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `DD/MM/YYYY`, the format people read in Argentina. */
export function fmtFechaAR(d: Date | null): string {
  if (!d) return '';
  return (
    String(d.getUTCDate()).padStart(2, '0') +
    '/' +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    '/' +
    d.getUTCFullYear()
  );
}

/**
 * The `Movimientos` cell is a dash-separated list of punch times (`"08:00 - 12:05 - 12:30"`).
 * Unparseable entries are dropped rather than failing the row: a malformed punch must not
 * make the whole day disappear from the evidence.
 */
export function parsearMovimientos(valor: ValorCelda): number[] {
  const s = celdaTexto(valor).trim();
  if (!s) return [];
  return s
    .split('-')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((t) => {
      const m = t.match(/^(\d{1,2}):(\d{2})$/);
      return m ? +(m[1] as string) * 60 + +(m[2] as string) : null;
    })
    .filter((v): v is number => v !== null);
}

/**
 * Reads the `Turno` column.
 *
 * `"F:"` marks a flexible shift — but `"F: 0hs"` (any zero value, comma or dot decimal
 * separator) is a franco: the person has no obligation to work that day at all, so it must
 * NOT fall through to fault/absence processing. A bare or malformed `"F:"` with no parseable
 * number keeps the flexible behaviour rather than silently becoming a día libre.
 *
 * An empty cell and `"00:00 - 00:00"` are días libres too.
 */
export function infoTurno(valor: ValorCelda): InfoTurno {
  const s = celdaTexto(valor).trim();
  if (s === '') return { esDiaLibre: true, esFlexible: false, inicio: null };
  if (s === '00:00 - 00:00') return { esDiaLibre: true, esFlexible: false, inicio: null };
  if (/^F:/i.test(s)) {
    const fNum = s.match(/^F:\s*([\d.,]+)/i);
    const horas = fNum ? parseFloat((fNum[1] as string).replace(',', '.')) : NaN;
    if (!isNaN(horas) && horas === 0) return { esDiaLibre: true, esFlexible: false, inicio: null };
    return { esDiaLibre: false, esFlexible: true, inicio: null };
  }
  const m = s.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return { esDiaLibre: false, esFlexible: false, inicio: null };
  return {
    esDiaLibre: false,
    esFlexible: false,
    inicio: +(m[1] as string) * 60 + +(m[2] as string),
  };
}

/** Minutes to `H:MM`, sign-aware (`-90` renders as `-1:30`). */
export function fmtMinutos(totalMin: number): string {
  const redondeado = Math.round(totalMin);
  const signo = redondeado < 0 ? '-' : '';
  const a = Math.abs(redondeado);
  return signo + Math.floor(a / 60) + ':' + String(a % 60).padStart(2, '0');
}

/** Minutes past midnight to a zero-padded clock time (`480` renders as `08:00`). */
export function fmtReloj(totalMin: number): string {
  return (
    String(Math.floor(totalMin / 60)).padStart(2, '0') + ':' + String(totalMin % 60).padStart(2, '0')
  );
}

/**
 * Canonical form of a person's name for comparison: trim, uppercase, decompose, strip the
 * combining diacritics, collapse runs of whitespace. QUICKPASS spells the same person's
 * name with and without accents between exports, so raw equality misses.
 */
export function normalizarNombre(valor: ValorCelda): string {
  return celdaTexto(valor)
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}
