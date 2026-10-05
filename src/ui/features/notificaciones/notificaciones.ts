/**
 * The decisions behind the Notificaciones screen that are worth a test: when a document may
 * be handed over, which selected days it covers, and how a day's notified state reads.
 * Pure, because Vitest never runs a `.tsx` test (see docs/estado-del-proyecto.md, «Pruebas»).
 */

import { totalDeFaltas, type NotificacionPersona } from '../../../notificaciones/index.js';
import type { ClaveNotificada, DiaConFaltas } from '../../faltas/porDia.js';

/** Explicit dates, never a persistent "all dates for this DNI" flag. */
export type SeleccionDias = ReadonlyMap<string, ReadonlySet<string>>;
export type DiasPorPersona = ReadonlyMap<string, readonly DiaConFaltas[]>;

/** A period change cannot keep selected dates merely because their person is still visible. */
export function seleccionVisible(seleccion: SeleccionDias, dias: DiasPorPersona): SeleccionDias {
  const visible = new Map<string, ReadonlySet<string>>();
  for (const [dni, fechas] of seleccion) {
    const vigentes = new Set(
      (dias.get(dni) ?? []).filter((dia) => fechas.has(dia.fecha)).map((dia) => dia.fecha),
    );
    if (vigentes.size > 0) visible.set(dni, vigentes);
  }
  return visible;
}

/** Both toggles begin with the visible selection, dropping stale dates on the next action. */
export function alternarDiaSeleccionado(
  seleccion: SeleccionDias,
  dias: DiasPorPersona,
  dni: string,
  fecha: string,
): SeleccionDias {
  const siguientes = new Map(seleccionVisible(seleccion, dias));
  if (!(dias.get(dni) ?? []).some((dia) => dia.fecha === fecha)) return siguientes;
  const fechas = new Set(siguientes.get(dni));
  if (fechas.has(fecha)) fechas.delete(fecha);
  else fechas.add(fecha);
  if (fechas.size > 0) siguientes.set(dni, fechas);
  else siguientes.delete(dni);
  return siguientes;
}

/** A partial person becomes fully selected; a fully selected person becomes empty. */
export function alternarPersonaSeleccionada(
  seleccion: SeleccionDias,
  dias: DiasPorPersona,
  dni: string,
): SeleccionDias {
  const siguientes = new Map(seleccionVisible(seleccion, dias));
  const fechas = new Set((dias.get(dni) ?? []).map((dia) => dia.fecha));
  if (fechas.size === 0 || siguientes.get(dni)?.size === fechas.size) siguientes.delete(dni);
  else siguientes.set(dni, fechas);
  return siguientes;
}

/**
 * Cut the already-grouped rows, preserving their identity and order. Word generation and
 * notified keys both consume this exact result; no second grouping or fault calculation.
 */
export function personasSeleccionadas(
  personas: readonly NotificacionPersona[],
  seleccion: SeleccionDias,
): readonly NotificacionPersona[] {
  return personas.flatMap((persona) => {
    const fechas = seleccion.get(persona.dni);
    if (!fechas || fechas.size === 0) return [];
    const faltasPorTipo = {
      incompleta: persona.faltasPorTipo.incompleta.filter((item) => fechas.has(item.fecha)),
      descanso: persona.faltasPorTipo.descanso.filter((item) => fechas.has(item.fecha)),
      tardanza: persona.faltasPorTipo.tardanza.filter((item) => fechas.has(item.fecha)),
    };
    return totalDeFaltas(faltasPorTipo) > 0 ? [{ ...persona, faltasPorTipo }] : [];
  });
}

export type ResultadoEntrega = 'entregado' | 'no_registrado';

/** What the operator reads when the record failed and the Word was therefore withheld. */
export const MENSAJE_SIN_REGISTRO =
  'No se pudo registrar la notificación; el Word no se descargó. Probá de nuevo.';

/**
 * Records first, hands over second, and never the other way round.
 *
 * Generating the Word is what marks its faltas as notified, so a letter must not leave the
 * app without its record: when `registrar` reports failure, `entregar` is not called at all.
 * A document whose rows have no readable date covers no key (`clavesNotificadas` skips them);
 * there is nothing to record and it is handed over as before.
 */
export async function entregarRegistrado(
  claves: readonly ClaveNotificada[],
  registrar: (claves: readonly ClaveNotificada[]) => Promise<boolean>,
  entregar: () => void,
): Promise<ResultadoEntrega> {
  if (claves.length > 0 && !(await registrar(claves))) return 'no_registrado';
  entregar();
  return 'entregado';
}

/**
 * The chip a day row shows: «Notificada» when every falta of the day is on record, «N de M
 * notificadas» when only some are, nothing when none is.
 */
export function etiquetaNotificacion(cuenta: {
  readonly notificadas: number;
  readonly total: number;
}): string | null {
  if (cuenta.notificadas === 0 || cuenta.total === 0) return null;
  if (cuenta.notificadas >= cuenta.total) return 'Notificada';
  return `${cuenta.notificadas} de ${cuenta.total} notificadas`;
}
