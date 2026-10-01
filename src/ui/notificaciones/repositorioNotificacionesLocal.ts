/**
 * The offline record of notified faltas: this browser's localStorage.
 *
 * Same rules as the server, so the offline path behaves the same rather than merely looking
 * similar: a key is `(dni, fechaIso, tipo)`, recording is idempotent, and a key already on
 * record keeps its FIRST `notificadoAt`. The blob is a map `${dni}|${fechaIso}|${tipo}` →
 * timestamp, written with ONE `setItem`, so a failed write leaves the previous record whole.
 *
 * It holds DNIs and dates only — no name, no letter — like the offline ausencias registry.
 */

import type { TipoFalta } from '../../domain/fichadas/index.js';
import { idFaltaNotificada } from '../faltas/porDia.js';
import { ErrorRepositorio } from '../historial/RepositorioFichadas.js';
import type { FaltaNotificada, RepositorioNotificaciones } from './RepositorioNotificaciones.js';

export const CLAVE_ALMACEN_NOTIFICADAS = 'controlhorario.notificadas.v1';

type Registro = Record<string, string>;

const TIPOS: ReadonlySet<string> = new Set(['incompleta', 'descanso', 'tardanza']);

function almacenDisponible(): Storage | null {
  try {
    const s = globalThis.localStorage;
    const sonda = `${CLAVE_ALMACEN_NOTIFICADAS}.probe`;
    s.setItem(sonda, '1');
    s.removeItem(sonda);
    return s;
  } catch {
    return null;
  }
}

/** `dni|YYYY-MM-DD|tipo` back into its parts. The DNI may itself contain anything but `|`. */
function partes(id: string): { dni: string; fecha: string; tipo: TipoFalta } | null {
  const m = /^(.*)\|(\d{4}-\d{2}-\d{2})\|([a-z]+)$/.exec(id);
  if (!m || !TIPOS.has(m[3] as string)) return null;
  return { dni: m[1] as string, fecha: m[2] as string, tipo: m[3] as TipoFalta };
}

export function crearRepositorioNotificacionesLocal(
  storage: Storage | null = almacenDisponible(),
  ahora: () => Date = () => new Date(),
): RepositorioNotificaciones {
  let memoria: Registro = {};

  function leer(): Registro {
    if (!storage) return memoria;
    let crudo: string | null;
    try {
      crudo = storage.getItem(CLAVE_ALMACEN_NOTIFICADAS);
    } catch {
      return memoria;
    }
    if (!crudo) return {};
    try {
      const parseado: unknown = JSON.parse(crudo);
      if (!parseado || typeof parseado !== 'object' || Array.isArray(parseado)) return {};
      return parseado as Registro;
    } catch {
      throw new ErrorRepositorio(
        'El registro de notificaciones guardado en este navegador no se pudo leer: el ' +
          'contenido está dañado.',
      );
    }
  }

  function escribir(registro: Registro): void {
    memoria = registro;
    if (!storage) return;
    try {
      storage.setItem(CLAVE_ALMACEN_NOTIFICADAS, JSON.stringify(registro));
    } catch {
      throw new ErrorRepositorio('No se pudo guardar la notificación en este navegador.');
    }
  }

  return {
    async listar(desdeIso, hastaIso) {
      const salida: FaltaNotificada[] = [];
      for (const [id, notificadoAt] of Object.entries(leer())) {
        const clave = partes(id);
        // ISO dates compare correctly as strings, both ends included like the server.
        if (!clave || clave.fecha < desdeIso || clave.fecha > hastaIso) continue;
        salida.push({ ...clave, notificadoAt });
      }
      return salida;
    },

    async registrar(claves) {
      const registro = { ...leer() };
      const momento = ahora().toISOString();
      let cambio = false;
      for (const c of claves) {
        const id = idFaltaNotificada(c.dni, c.fechaIso, c.tipo);
        if (Object.hasOwn(registro, id)) continue;
        registro[id] = momento;
        cambio = true;
      }
      if (cambio) escribir(registro);
    },
  };
}
