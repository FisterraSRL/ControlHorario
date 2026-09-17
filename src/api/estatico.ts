/**
 * Serving the built SPA, and the fallback that makes deep links work.
 *
 * NOT USED IN PRODUCTION ANY MORE, AND KEPT ANYWAY. The production frontend is on Vercel,
 * where the same job is done by the `rewrites` entry of `vercel.json`; on Azure this process
 * finds no `index.html` and boots API-only through `registrarSinSpa` below, which is the
 * intended shape. This file is what serves the SPA in the local development stack, and it
 * is the way back if the Azure trial does not work out.
 *
 * The app routes with `BrowserRouter`, so `/carga`, `/ausencias` and `/configuracion` are
 * real URLs that a person will bookmark, paste into a chat, and reload on. None of them is
 * a file on disk. Without a fallback the server 404s and the operator concludes the system
 * is down. That is true of Vercel exactly as it is of this file, which is why
 * `docs/despliegue.md` §5.5 checks `/ausencias` after a deploy and not just `/`.
 *
 * The fallback is narrow on purpose:
 *   * only GET and HEAD — a POST to a wrong path is a bug, not a deep link;
 *   * never under `/api/`, which answers JSON or 404 JSON and must never hand a browser an
 *     HTML page that looks like it worked;
 *   * only when the client will accept HTML, so `curl` and fetch() get an honest 404.
 */

import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';

import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** Vite writes content-hashed filenames here; anything under it can be cached forever. */
const PREFIJO_INMUTABLE = '/assets/';

export async function existeSpa(directorio: string): Promise<boolean> {
  try {
    await access(join(directorio, 'index.html'), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function registrarEstatico(
  app: FastifyInstance,
  directorio: string,
): Promise<void> {
  await app.register(fastifyStatic, {
    root: directorio,
    // Off, because the two cases need opposite answers: hashed assets are immutable, and
    // index.html must never be cached or a redeploy keeps serving the previous bundle from
    // the operator's browser with no way for them to know.
    cacheControl: false,
    setHeaders(respuesta, ruta) {
      const cabecera = ruta.replaceAll('\\', '/').includes(PREFIJO_INMUTABLE)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache';
      void respuesta.header('cache-control', cabecera);
    },
  });

  app.setNotFoundHandler(async (peticion, respuesta) => {
    const esLectura = peticion.method === 'GET' || peticion.method === 'HEAD';
    const esApi = peticion.url === '/api' || peticion.url.startsWith('/api/');
    const quiereHtml = (peticion.headers.accept ?? '').includes('text/html');

    if (esLectura && !esApi && quiereHtml) {
      return respuesta.code(200).header('cache-control', 'no-cache').type('text/html').sendFile('index.html');
    }

    return respuesta.code(404).send({
      error: 'no_encontrado',
      mensaje: `No existe ${peticion.method} ${peticion.url.split('?')[0] ?? ''}.`,
    });
  });
}

/**
 * The API-only 404, used when there is no `dist/` to serve. Registered instead of the SPA
 * fallback so a missing build is an obvious 404 with a reason, not a blank page.
 */
export function registrarSinSpa(app: FastifyInstance, directorio: string): void {
  app.setNotFoundHandler(async (peticion, respuesta) =>
    respuesta.code(404).send({
      error: 'no_encontrado',
      mensaje:
        peticion.url.startsWith('/api/') || peticion.url === '/health'
          ? `No existe ${peticion.method} ${peticion.url.split('?')[0] ?? ''}.`
          : `No hay una build del frontend en "${directorio}". Corré "npm run build" o revisá ` +
            'API_DIR_ESTATICO.',
    }),
  );
}
