/**
 * The only adapter for `RepositorioFichadas` in this slice: localStorage, with an in-memory
 * fallback for the cases where the browser refuses to give us any (private windows, storage
 * disabled by policy, a full quota).
 *
 * This is scaffolding for a working screen, not the destination. It is per-browser and
 * per-device: nothing here is shared with the rest of the team, and clearing site data
 * clears the historial. Slice 2c replaces it with a Postgres adapter behind the same port.
 */

import type { FilaQuickpass } from '../../domain/fichadas/index.js';
import {
  ErrorRepositorio,
  claveDeFila,
  type ClaveFichada,
  type RepositorioFichadas,
  type ResultadoGuardado,
} from './RepositorioFichadas.js';

const CLAVE_ALMACEN = 'controlhorario.historial.v1';

type MapaHistorial = Record<ClaveFichada, FilaQuickpass>;

/**
 * `Object.keys` preserves insertion order for string keys that are not array indices.
 * `DNI|Fecha` always contains a pipe, so it never looks like an index and the historial
 * keeps the order rows were first seen in.
 */
function leerDesde(storage: Storage | null, memoria: MapaHistorial): MapaHistorial {
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
    return parseado as MapaHistorial;
  } catch {
    // A corrupted blob is a real possibility (a half-written quota-exceeded write). Say so
    // rather than starting from an empty historial as if nothing had been stored.
    throw new ErrorRepositorio(
      'El historial guardado en este navegador no se pudo leer: el contenido está dañado.',
    );
  }
}

function escribirEn(storage: Storage | null, mapa: MapaHistorial): void {
  if (!storage) return;
  try {
    storage.setItem(CLAVE_ALMACEN, JSON.stringify(mapa));
  } catch {
    throw new ErrorRepositorio(
      'No se pudo guardar el historial en este navegador. Puede que se haya llenado el espacio ' +
        'disponible o que el almacenamiento esté deshabilitado.',
    );
  }
}

/** Returns the browser storage, or null when the browser will not give us one. */
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

export function crearRepositorioLocal(
  storage: Storage | null = almacenDisponible(),
): RepositorioFichadas {
  // Used verbatim when there is no storage, and ignored entirely when there is.
  let memoria: MapaHistorial = {};

  return {
    async listar() {
      const mapa = leerDesde(storage, memoria);
      return Object.values(mapa);
    },

    async upsert(filas) {
      const mapa = leerDesde(storage, memoria);
      let nuevas = 0;
      let actualizadas = 0;
      let sinCambios = 0;
      let descartadas = 0;

      for (const fila of filas) {
        const clave = claveDeFila(fila);
        if (!clave) {
          descartadas++;
          continue;
        }
        const previa = mapa[clave];
        if (!previa) {
          mapa[clave] = fila;
          nuevas++;
        } else if (JSON.stringify(previa) !== JSON.stringify(fila)) {
          mapa[clave] = fila;
          actualizadas++;
        } else {
          sinCambios++;
        }
      }

      if (nuevas > 0 || actualizadas > 0) {
        escribirEn(storage, mapa);
        if (!storage) memoria = mapa;
      }

      const resultado: ResultadoGuardado = {
        recibidas: filas.length,
        descartadas,
        nuevas,
        actualizadas,
        sinCambios,
        totalHistorial: Object.keys(mapa).length,
      };
      return resultado;
    },

    async vaciar() {
      memoria = {};
      if (!storage) return;
      try {
        storage.removeItem(CLAVE_ALMACEN);
      } catch {
        throw new ErrorRepositorio('No se pudo vaciar el historial guardado en este navegador.');
      }
    },
  };
}
