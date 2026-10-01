/**
 * The decisions behind the Notificaciones screen that are worth a test: when a document may
 * be handed over, and how a day's notified state reads. Pure, because Vitest never runs a
 * `.tsx` test (see docs/estado-del-proyecto.md, «Pruebas»).
 */

import type { ClaveNotificada } from '../../faltas/porDia.js';

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
