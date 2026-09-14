/**
 * The second adapter for `RepositorioFichadas`: the API over HTTP.
 *
 * The screens do not know this file exists. `HistorialProvider` picks an adapter at
 * startup, both implement the same three methods, and `CargaContainer` is byte-identical
 * to what it was when the only option was localStorage. That was the point of the port.
 *
 * Errors come out as `ErrorRepositorio` with a message written for the operator, not for a
 * developer: whoever is looking at this screen at 11pm is the person who uploaded the
 * spreadsheet, and "Failed to fetch" tells them nothing they can act on.
 */

import type { FilaQuickpass } from '../../domain/fichadas/index.js';
import {
  ErrorRepositorio,
  type RepositorioFichadas,
  type ResultadoGuardado,
} from './RepositorioFichadas.js';

/** Long enough for a year of QUICKPASS over a domestic uplink; short enough to not hang. */
const TIEMPO_LIMITE_MS = 120_000;

interface CuerpoListar {
  readonly filas: readonly FilaQuickpass[];
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function esCuerpoListar(valor: unknown): valor is CuerpoListar {
  return esObjeto(valor) && Array.isArray(valor['filas']);
}

/**
 * The counters drive the numbers the operator reads on the load summary. A response that is
 * missing one would render `undefined` where a row count belongs, on the screen whose whole
 * job is to say what was stored — so the shape is checked rather than asserted.
 */
function esResultadoGuardado(valor: unknown): valor is ResultadoGuardado {
  if (!esObjeto(valor)) return false;
  const campos = [
    'recibidas',
    'descartadas',
    'nuevas',
    'actualizadas',
    'sinCambios',
    'totalHistorial',
  ] as const;
  return campos.every((c) => typeof valor[c] === 'number');
}

/**
 * The server's own explanation when it sent one, and a plain sentence when it did not.
 * A 502 from the tunnel is an HTML page, not JSON, and reading it as JSON throws — which
 * is exactly the case that needs a readable message, so it is handled rather than raised.
 */
async function mensajeDelError(respuesta: Response): Promise<string> {
  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch {
    cuerpo = null;
  }
  if (esObjeto(cuerpo)) {
    const mensaje = cuerpo['mensaje'];
    if (typeof mensaje === 'string' && mensaje !== '') return mensaje;
  }
  if (respuesta.status === 502 || respuesta.status === 503 || respuesta.status === 504) {
    return (
      'El servidor no está respondiendo en este momento. Si acaba de reiniciarse puede ' +
      'tardar un minuto; si sigue así, avisá a quien administra el servidor.'
    );
  }
  return `El servidor respondió ${respuesta.status}.`;
}

function errorDeRed(e: unknown): ErrorRepositorio {
  if (e instanceof DOMException && e.name === 'AbortError') {
    return new ErrorRepositorio(
      'El servidor tardó demasiado en responder y se canceló la operación. Los datos pueden ' +
        'haberse guardado igual: volvé a entrar y fijate antes de reintentar la carga.',
    );
  }
  return new ErrorRepositorio(
    'No se pudo contactar al servidor. Revisá la conexión a internet y volvé a intentar.',
  );
}

async function pedir(url: string, init: RequestInit): Promise<Response> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, { ...init, signal: AbortSignal.timeout(TIEMPO_LIMITE_MS) });
  } catch (e: unknown) {
    throw errorDeRed(e);
  }
  if (!respuesta.ok) throw new ErrorRepositorio(await mensajeDelError(respuesta));
  return respuesta;
}

/**
 * `base` is whatever `VITE_API_BASE_URL` held at build time — `/api` in the container
 * image, so the browser calls back to the origin that served the page and the tunnel in
 * front is invisible. An absolute URL works too, for pointing a local dev build at the
 * office server.
 */
export function crearRepositorioHttp(base: string): RepositorioFichadas {
  const raiz = base.replace(/\/+$/, '');
  const fichadas = `${raiz}/fichadas`;

  return {
    async listar() {
      const respuesta = await pedir(fichadas, { method: 'GET' });
      let cuerpo: unknown;
      try {
        cuerpo = await respuesta.json();
      } catch {
        throw new ErrorRepositorio('El servidor devolvió una respuesta que no se pudo leer.');
      }
      if (!esCuerpoListar(cuerpo)) {
        throw new ErrorRepositorio(
          'El servidor devolvió el historial en un formato inesperado. Puede que la aplicación ' +
            'y el servidor no estén en la misma versión: recargá la página.',
        );
      }
      return cuerpo.filas;
    },

    async upsert(filas) {
      const respuesta = await pedir(fichadas, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filas }),
      });
      let cuerpo: unknown;
      try {
        cuerpo = await respuesta.json();
      } catch {
        throw new ErrorRepositorio(
          'La carga se envió pero el servidor devolvió una respuesta que no se pudo leer. ' +
            'Recargá la página y fijate si los datos llegaron antes de reintentar.',
        );
      }
      if (!esResultadoGuardado(cuerpo)) {
        throw new ErrorRepositorio(
          'La carga se envió pero el servidor no informó qué guardó. Recargá la página y ' +
            'fijate si los datos llegaron antes de reintentar.',
        );
      }
      return cuerpo;
    },

    async vaciar() {
      await pedir(fichadas, { method: 'DELETE' });
    },
  };
}
