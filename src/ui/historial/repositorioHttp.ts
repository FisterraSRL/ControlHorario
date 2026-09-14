/**
 * The second adapter for `RepositorioFichadas`: the API over HTTP.
 *
 * The screens do not know this file exists. `HistorialProvider` gets an adapter injected,
 * both implement the same three methods, and `CargaContainer` is byte-identical to what it
 * was when the only option was localStorage. That was the point of the port.
 *
 * The request plumbing — the timeout, `credentials: 'same-origin'`, the operator-readable
 * message for every failure, and the 401 that means "the session ended" rather than "this
 * went wrong" — lives in `../http.ts`, shared with the other three HTTP adapters. It was
 * inlined here when this was the only one.
 *
 * A 401 propagates as `ErrorNoAutenticado` and is NOT wrapped: the app has to show the login
 * screen for it, and a session that expired mid-afternoon is not an error the operator did
 * anything about.
 */

import type { FilaQuickpass } from '../../domain/fichadas/index.js';
import { ErrorApi, ErrorNoAutenticado, esObjeto, leerJson, pedir } from '../http.js';
import {
  ErrorRepositorio,
  type RepositorioFichadas,
  type ResultadoGuardado,
} from './RepositorioFichadas.js';

interface CuerpoListar {
  readonly filas: readonly FilaQuickpass[];
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

/** Anything that is not "log in again" reaches the screens as `ErrorRepositorio`. */
function comoErrorRepositorio(e: unknown): never {
  if (e instanceof ErrorNoAutenticado) throw e;
  if (e instanceof ErrorApi) throw new ErrorRepositorio(e.message);
  throw e;
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
      let cuerpo: unknown;
      try {
        cuerpo = await leerJson(await pedir(fichadas, { method: 'GET' }));
      } catch (e: unknown) {
        comoErrorRepositorio(e);
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
      let cuerpo: unknown;
      try {
        const respuesta = await pedir(fichadas, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ filas }),
        });
        cuerpo = await respuesta.json();
      } catch (e: unknown) {
        if (e instanceof ErrorNoAutenticado || e instanceof ErrorApi) comoErrorRepositorio(e);
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
      try {
        await pedir(fichadas, { method: 'DELETE' });
      } catch (e: unknown) {
        comoErrorRepositorio(e);
      }
    },
  };
}
