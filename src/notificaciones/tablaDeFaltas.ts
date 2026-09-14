/**
 * The per-falta table: one titled, highlighted block of rows for each kind of irregularity
 * a person actually incurred in the period.
 *
 * Legacy: `FAULT_META`, `FAULT_ORDER` and `buildFaultTable` (legacy/app.html ~lines
 * 1861-1865, 1150 and 1988-2003).
 */

import { wTable } from './ooxml.js';
import type { TipoFalta } from '../domain/fichadas/tipos.js';
import type {
  Densidad,
  FaltasPorTipo,
  ItemFaltaBase,
  SeccionDeFaltas,
} from './tipos.js';

/** How one kind of falta presents itself on the page. */
export interface MetaFalta {
  /** The section title, printed after its ordinal. Reaches the employee verbatim. */
  readonly label: string;
  /** Text colour of the highlighted column, bare RRGGBB. */
  readonly color: string;
  /** Fill of the highlighted column, bare RRGGBB. */
  readonly shade: string;
}

/**
 * Label, colour and tint per falta.
 *
 * The colours mirror the app's own fault chips (incompleta = amber, descanso = blue,
 * tardanza = red) so the printed page speaks the same visual language as the screen.
 *
 * Note that `tardanza`'s label here is the plural "Llegadas tarde", while the on-screen
 * `FAULT_LABEL` table in the legacy says the singular "Llegada tarde". Both are the
 * legacy's; the printed one is the one this module owns and it is reproduced as found.
 */
export const META_FALTAS: Readonly<Record<TipoFalta, MetaFalta>> = {
  incompleta: { label: 'Fichadas incompletas', color: 'A66A10', shade: 'FBEBD3' },
  descanso: { label: 'Exceso de descanso', color: '2E6F9E', shade: 'DEEBF5' },
  tardanza: { label: 'Llegadas tarde', color: 'B93A2A', shade: 'FBE1DC' },
};

/**
 * The order the sections are printed in, and therefore the order they are numbered in.
 * It is a business-facing decision, not an implementation detail: the letter always leads
 * with fichadas incompletas.
 */
export const ORDEN_FALTAS: readonly TipoFalta[] = ['incompleta', 'descanso', 'tardanza'];

/** Printed wherever a value is missing. U+2014 EM DASH, as in the legacy. */
export const SIN_DATO = '—';

/**
 * Index of the offending-value column. Every falta's table is four columns wide and the
 * last one is the one that gets highlighted.
 */
export const COLUMNA_RESALTADA = 3;

/**
 * Splits a person's faltas into printable sections, in `ORDEN_FALTAS` order, dropping the
 * kinds they did not incur.
 *
 * The three entries are written out literally rather than looped over `ORDEN_FALTAS`
 * because that is what keeps each `tipo` paired with its own row type; a loop would erase
 * the correlation and force a cast. `seccionesDeFaltas` order and `ORDEN_FALTAS` are held
 * together by a test.
 */
export function seccionesDeFaltas(faltasPorTipo: FaltasPorTipo): readonly SeccionDeFaltas[] {
  const todas: readonly SeccionDeFaltas[] = [
    { tipo: 'incompleta', items: faltasPorTipo.incompleta },
    { tipo: 'descanso', items: faltasPorTipo.descanso },
    { tipo: 'tardanza', items: faltasPorTipo.tardanza },
  ];
  return todas.filter((s) => s.items.length > 0);
}

/** Total faltas across every kind. The legacy carried this as a redundant `total` field. */
export function totalDeFaltas(faltasPorTipo: FaltasPorTipo): number {
  return (
    faltasPorTipo.incompleta.length +
    faltasPorTipo.descanso.length +
    faltasPorTipo.tardanza.length
  );
}

/**
 * Sort key of a row.
 *
 * A missing date sorts as the epoch and an unparseable one produces `NaN`, which leaves
 * that row where it was. Both reproduce the legacy's `a.dateObj - b.dateObj`, where `null`
 * coerced to 0 and an Invalid Date coerced to `NaN`.
 */
function tiempoDe(item: ItemFaltaBase): number {
  return item.fechaOrden === null ? 0 : item.fechaOrden.getTime();
}

/** Rows sorted oldest first, without touching the caller's array. */
function ordenarPorFecha<T extends ItemFaltaBase>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => tiempoDe(a) - tiempoDe(b));
}

/**
 * Builds one falta's table.
 *
 * Every kind gets the same four-column shape the reference model uses for tardanza
 * (Fecha | Horario de Turno | <what happened> | <the offending value>), with the last
 * column highlighted in that falta's colour. The column headings are the ones on the
 * document Fisterra sends today and are reproduced verbatim.
 *
 * An empty `items` renders the header row alone. The letter never asks for that — sections
 * with nothing in them are dropped by `seccionesDeFaltas` first — but the table is well
 * defined either way.
 */
export function buildTablaDeFaltas(seccion: SeccionDeFaltas, densidad: Densidad): string {
  const meta = META_FALTAS[seccion.tipo];
  let headers: readonly string[];
  let filas: readonly (readonly string[])[];

  switch (seccion.tipo) {
    case 'tardanza':
      headers = ['Fecha', 'Horario de Turno', 'Horario Fichado', 'Minutos de Tardanza'];
      filas = ordenarPorFecha(seccion.items).map((it) => [
        it.fecha,
        it.turnoRaw || SIN_DATO,
        it.horarioFichado,
        it.minutos,
      ]);
      break;
    case 'descanso':
      headers = ['Fecha', 'Horario de Turno', 'Descanso Tomado', 'Minutos de Exceso'];
      filas = ordenarPorFecha(seccion.items).map((it) => [
        it.fecha,
        it.turnoRaw || SIN_DATO,
        it.descansoTomado,
        it.exceso,
      ]);
      break;
    case 'incompleta':
      headers = ['Fecha', 'Horario de Turno', 'Fichadas Registradas', 'Cantidad'];
      filas = ordenarPorFecha(seccion.items).map((it) => [
        it.fecha,
        it.turnoRaw || SIN_DATO,
        it.registradas,
        it.cantidad,
      ]);
      break;
  }

  return wTable(headers, filas, densidad, {
    highlightCol: COLUMNA_RESALTADA,
    color: meta.color,
    shade: meta.shade,
  });
}
