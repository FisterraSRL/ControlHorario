/**
 * Writing to `auditoria`.
 *
 * WHAT GOES IN, AND THE ONE PLACE THIS DIFFERS FROM THE RULE IN `repositorioAzureSql.ts`.
 *
 * The upload audit row says "somebody loaded 412 rows" and carries counters only, because
 * naming a person there would add nothing. The rows written here are different: they record
 * a decision a human took ABOUT a specific person on a specific day — "who classified whose
 * absence as Enfermedad, and when". An audit of that which does not say which day it was
 * about is not an audit, it is a log line. So `entidad_id` holds `DNI|YYYY-MM-DD`.
 *
 * That is a deliberate, narrow exception and it stops there:
 *
 *   * `datos` never carries a name, a sector, a legajo, a motivo LABEL, a filename or a
 *     payload — only ids, counts and the before/after of the field that changed;
 *   * nothing in this file is ever logged: an audit row goes to Azure SQL, not to pino.
 *
 * Append-only. There is no update and no delete, here or anywhere else.
 */

import type { Pool, PoolClient } from './db.js';

/**
 * The closed list of things that can be audited. A string literal union rather than a free
 * `string`, so a typo is a compile error and `SELECT ... WHERE accion = 'motivo_asignado'`
 * cannot silently return nothing because somebody wrote `motivoAsignado` once.
 */
export type AccionAuditada =
  | 'carga'
  | 'vaciar_historial'
  | 'login'
  | 'login_fallido'
  | 'logout'
  | 'usuario_creado'
  | 'motivo_asignado'
  | 'motivo_quitado'
  | 'ausencias_sincronizadas'
  | 'adjunto_subido'
  | 'adjunto_descargado'
  | 'adjunto_eliminado'
  | 'config_actualizada'
  | 'sector_regla_actualizada'
  | 'motivo_creado'
  | 'motivo_editado'
  | 'motivo_retirado'
  | 'exclusion_agregada'
  | 'exclusion_quitada'
  | 'exclusiones_sembradas';

export interface EntradaAuditoria {
  /** Who. The email of the logged-in operator, or `config.operador` for boot-time work. */
  readonly actor: string;
  readonly accion: AccionAuditada;
  /** The table the change is about. */
  readonly entidad: string;
  /** Its key. `DNI|YYYY-MM-DD` for a day; an id for anything with one. */
  readonly entidadId?: string | null;
  /** Ids, counts and before/after values. Never a label, a name or a file. */
  readonly datos?: Record<string, unknown> | null;
}

export async function auditar(
  cliente: Pool | PoolClient,
  entrada: EntradaAuditoria,
): Promise<void> {
  await cliente.query(
    `INSERT INTO [controlhorario].[auditoria] ([actor], [accion], [entidad], [entidad_id], [datos])
     VALUES ($1, $2, $3, $4, $5)`,
    [
      entrada.actor,
      entrada.accion,
      entrada.entidad,
      entrada.entidadId ?? null,
      entrada.datos === undefined || entrada.datos === null
        ? null
        : JSON.stringify(entrada.datos),
    ],
  );
}

/** `DNI|YYYY-MM-DD`, the key of a decision about one person on one day. */
export function idDeDia(dni: string, fechaIso: string): string {
  return `${dni}|${fechaIso}`;
}
