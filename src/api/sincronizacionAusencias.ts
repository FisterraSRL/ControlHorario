/**
 * The one way the server re-derives the absence registry: the upload's second half, shared.
 *
 * It runs after an upload (`rutas.ts`) and after a motivo is created or retired
 * (`rutasConfiguracion.ts`), and the second case is why it is its own function. The QUICKPASS
 * note is matched against the labels of the ACTIVE motivos (`clasificarPartes`), so the list
 * of motivos is an input of the registry exactly like the evidence is: a day uploaded before
 * "Licencia por examen" existed was stored unclassified, and one classified from a label that
 * was later retired would keep a motivo nobody can choose any more. Without this re-run the
 * Ausencias screen — which reads the persisted registry — and Horas trabajadas — which runs
 * the engine with the current motivos — would show two different motivos for the same day.
 *
 * It is the SAME pass as the upload's, not a narrower one, and that is what makes it safe:
 * the MERGE in `repositorioAusencias.ts` only refreshes rows whose source is NULL or
 * 'partes'. Nothing a person decided ('manual', 'encargado') can change here.
 *
 * A FAILURE IS NOT THE CALLER'S FAILURE. The upload, or the new motivo, is already committed
 * and the operator must not be told otherwise; the registry is derived and the next pass
 * rebuilds it. So it is logged — counts and a sanitised error, never a row — and swallowed.
 */

import type { FastifyBaseLogger } from 'fastify';

import { errorDbParaLog } from './errores.js';
import type { RepositorioAusenciasAzureSql } from './repositorioAusencias.js';
import type { RepositorioConfiguracionAzureSql } from './repositorioConfiguracion.js';
import type { RepositorioFichadasAzureSql } from './repositorioAzureSql.js';

export interface DependenciasSincronizacion {
  readonly fichadas: Pick<RepositorioFichadasAzureSql, 'listar'>;
  readonly ausencias: Pick<RepositorioAusenciasAzureSql, 'sincronizar'>;
  readonly configuracion: Pick<RepositorioConfiguracionAzureSql, 'paraElMotor'>;
}

export async function resincronizarAusencias(
  deps: DependenciasSincronizacion,
  actor: string,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    // Read AFTER the caller's write committed, so a motivo just created or retired is
    // already in (or out of) the active list this pass matches against.
    const cfg = await deps.configuracion.paraElMotor();
    // Unscoped on purpose, and this is the one read that must be: the registry is
    // re-derived for the WHOLE company, and a sector-shaped view of the evidence would
    // prune every registry row outside it as if the day had stopped being an absence.
    const filas = await deps.fichadas.listar(null);
    const sincronizacion = await deps.ausencias.sincronizar(filas, cfg, actor);
    log.info({ evento: 'ausencias_sincronizadas', ...sincronizacion }, 'registro de ausencias al día');
  } catch (e: unknown) {
    log.error(errorDbParaLog(e), 'no se pudo sincronizar el registro de ausencias');
  }
}
