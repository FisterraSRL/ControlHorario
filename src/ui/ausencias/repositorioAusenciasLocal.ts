/**
 * The offline absence registry: derived on read, decisions kept in localStorage.
 *
 * THE SERVER PERSISTS THE REGISTRY; THIS DERIVES IT. That difference is deliberate and it is
 * not a shortcut.
 *
 * On the server the registry has to be a table: `ausencias_pendientes` is a SQL view, slice 3
 * builds a manager's request from a query over it, and a row has to exist for a foreign key
 * to hang an attachment off. So the server upserts one row per absence at import time
 * (`syncAusenciasHistorial`) and prunes the orphans afterwards (`pruneStaleAusencias`).
 *
 * Here there is no SQL, no attachments and no second reader. Deriving the list from the
 * historial on every read gives the same answer with no sync step to get wrong:
 *
 *   * a day the engine reads as an absence is in the list — that IS the sync;
 *   * a stored decision for a day that is no longer an absence disappears when it has no
 *     motivo, and stays when it has one — that IS the prune, and conservatively, because
 *     the stored decision is never deleted, only left out of the list;
 *   * a motivo the operator chose is read from storage and wins over the QUICKPASS note —
 *     that is the precedence rule, the same one the server writes as
 *     `WHERE motivo_source IS DISTINCT FROM 'manual'`.
 *
 * The engine is imported, not reimplemented: which days are absences and what the QUICKPASS
 * note means are decided by `construirRegistroDia`, exactly as on the server.
 */

import { construirRegistroDia } from '../../domain/fichadas/index.js';
import type { OrigenMotivo } from '../../domain/fichadas/index.js';
import { ErrorRepositorio, type RepositorioFichadas } from '../historial/RepositorioFichadas.js';
import {
  claveRegistro,
  fechaIsoDesdeAR,
  type AusenciaRegistrada,
  type RepositorioAusencias,
} from './RepositorioAusencias.js';

const CLAVE_ALMACEN = 'controlhorario.ausencias.v1';

interface DecisionGuardada {
  readonly motivoId: number | null;
  readonly motivoSource: OrigenMotivo | null;
  readonly resueltoAt: string | null;
}

type MapaDecisiones = Record<string, DecisionGuardada>;

function almacenDisponible(): Storage | null {
  try {
    const s = globalThis.localStorage;
    const sonda = `${CLAVE_ALMACEN}.probe`;
    s.setItem(sonda, '1');
    s.removeItem(sonda);
    return s;
  } catch {
    return null;
  }
}

export function crearRepositorioAusenciasLocal(
  fichadas: RepositorioFichadas,
  storage: Storage | null = almacenDisponible(),
): RepositorioAusencias {
  let memoria: MapaDecisiones = {};

  function leer(): MapaDecisiones {
    if (!storage) return memoria;
    let crudo: string | null;
    try {
      crudo = storage.getItem(CLAVE_ALMACEN);
    } catch {
      return memoria;
    }
    if (!crudo) return {};
    try {
      const parseado: unknown = JSON.parse(crudo);
      if (!parseado || typeof parseado !== 'object' || Array.isArray(parseado)) return {};
      return parseado as MapaDecisiones;
    } catch {
      throw new ErrorRepositorio(
        'Las clasificaciones guardadas en este navegador no se pudieron leer: el contenido ' +
          'está dañado.',
      );
    }
  }

  function escribir(mapa: MapaDecisiones): void {
    memoria = mapa;
    if (!storage) return;
    try {
      storage.setItem(CLAVE_ALMACEN, JSON.stringify(mapa));
    } catch {
      throw new ErrorRepositorio(
        'No se pudo guardar la clasificación en este navegador. Puede que se haya llenado el ' +
          'espacio disponible.',
      );
    }
  }

  return {
    async listar() {
      const decisiones = leer();
      const filas = await fichadas.listar();
      const salida: AusenciaRegistrada[] = [];
      const vistas = new Set<string>();

      for (const fila of filas) {
        // No cfg: `tipoDia` and the motivo the QUICKPASS note implies depend on neither the
        // sector rules nor the thresholds. See `construirRegistroDia`.
        const registro = construirRegistroDia(fila);
        if (registro.tipoDia !== 'ausencia' || !registro.dni) continue;
        const fechaIso = fechaIsoDesdeAR(registro.fechaStr);
        // A day with no readable date is a day Postgres could not store either; the two
        // adapters agree on which rows exist.
        if (!fechaIso) continue;

        const clave = claveRegistro(registro.dni, fechaIso);
        vistas.add(clave);
        const decision = decisiones[clave];
        // Precedence: what a person decided beats what the note said.
        const humana = decision && decision.motivoId !== null;
        salida.push({
          dni: registro.dni,
          fecha: fechaIso,
          motivoId: humana ? (decision.motivoId ?? null) : registro.motivoId,
          motivoSource: humana ? (decision.motivoSource ?? 'manual') : registro.motivoSource,
          resueltoPor: humana ? 'local' : null,
          resueltoAt: humana ? (decision.resueltoAt ?? null) : null,
          adjuntos: 0,
        });
      }

      // A classified day that stopped being an absence is kept, exactly as the server's
      // conservative prune keeps it. One with no motivo simply never appears.
      for (const [clave, decision] of Object.entries(decisiones)) {
        if (vistas.has(clave) || decision.motivoId === null) continue;
        const [dni = '', fecha = ''] = clave.split('|');
        salida.push({
          dni,
          fecha,
          motivoId: decision.motivoId,
          motivoSource: decision.motivoSource ?? 'manual',
          resueltoPor: 'local',
          resueltoAt: decision.resueltoAt ?? null,
          adjuntos: 0,
        });
      }

      return salida;
    },

    async asignarMotivo(dni, fechaStr, motivoId) {
      const fechaIso = fechaIsoDesdeAR(fechaStr);
      if (!fechaIso) {
        throw new ErrorRepositorio(`No se pudo interpretar la fecha "${fechaStr}".`);
      }
      const mapa = { ...leer() };
      const clave = claveRegistro(dni, fechaIso);
      const decision: DecisionGuardada = {
        motivoId,
        // Always manual, exactly like the legacy `setMotivo`: a later re-upload must not
        // silently override what a person chose.
        motivoSource: motivoId === null ? null : 'manual',
        resueltoAt: new Date().toISOString(),
      };
      mapa[clave] = decision;
      escribir(mapa);

      return {
        dni,
        fecha: fechaIso,
        motivoId: decision.motivoId,
        motivoSource: decision.motivoSource,
        resueltoPor: 'local',
        resueltoAt: decision.resueltoAt,
        adjuntos: 0,
      };
    },
  };
}
