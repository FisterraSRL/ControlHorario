/**
 * CORS — the one origin this API answers for.
 *
 * WHY IT EXISTS NOW AND DID NOT BEFORE. The frontend used to be served by this very
 * process, so every call was same-origin and the browser never asked. It is now a static
 * bundle on Vercel calling an API on Azure: two origins, so the browser applies the
 * same-origin policy and will not let the app read a single response unless this API says,
 * in a header, that that origin is allowed.
 *
 * THE RULES THIS FILE FOLLOWS, AND WHY EACH ONE IS NOT NEGOTIABLE.
 *
 * 1. ONE EXACT ORIGIN, ECHOED ONLY WHEN IT MATCHES. Not a wildcard, not a prefix, not a
 *    regex over `*.vercel.app` — every preview deployment of every project on Vercel lives
 *    under that suffix. The comparison is `===` against `APP_ORIGEN_FRONTEND`, which
 *    config.ts has already normalised to a bare origin.
 *
 * 2. `Access-Control-Allow-Origin: *` IS IMPOSSIBLE HERE ANYWAY. Authentication is a cookie,
 *    so the app sends `credentials: 'include'`, and the browser rejects the pair of a
 *    wildcard origin and `Allow-Credentials: true` outright. The setting that would be
 *    convenient is the setting that cannot work, which is a rare kindness.
 *
 * 3. `Vary: Origin`, ALWAYS, EVEN WHEN THE REQUEST HAS NO `Origin`. The body and headers of
 *    the answer depend on that request header. Without `Vary`, any shared cache in front of
 *    this API — Azure's, a corporate proxy — may hand a response computed for the allowed
 *    origin to a request from another one, which is the allow-list leaking through a cache.
 *
 * 4. THE PREFLIGHT IS ANSWERED BEFORE THE SESSION GUARD. A browser's `OPTIONS` preflight
 *    carries no cookies by design. Behind the guard in `autenticacion.ts` it would get a
 *    401, the browser would report a CORS failure, and the actual request would never be
 *    sent — for a user who is perfectly logged in. That is why `servidor.ts` registers this
 *    hook BEFORE `registrarAcceso`: Fastify runs `onRequest` hooks in registration order.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 *   * `Access-Control-Expose-Headers`. The app reads bodies and status codes and no response
 *     header at all — an attachment's real filename comes from the database row, not from
 *     `Content-Disposition` (see `AusenciasContainer.guardarComo`). Exposing headers nobody
 *     reads is surface for nothing.
 *
 *   * A second allowed origin for Vercel preview deployments. A preview build pointed at the
 *     production API would be writing to the real evidentiary database from a URL anybody
 *     with a pull request can create. Previews belong against a separate API, or against
 *     localStorage mode, which needs no server at all.
 *
 *   * A dependency. `@fastify/cors` does all of this and more, and "more" is the problem:
 *     the parts worth auditing are the four rules above, and they are twenty lines. This
 *     also keeps `package.json` unchanged, so nothing about the deployment turns on a new
 *     transitive tree.
 */

import type { FastifyInstance } from 'fastify';

import type { ConfiguracionApi } from './config.js';

/**
 * Methods the app actually uses. `OPTIONS` is not listed because it is the preflight itself,
 * and `HEAD` follows `GET` without being named.
 */
const METODOS = 'GET, POST, PUT, PATCH, DELETE';

/**
 * Request headers the app actually sets. `content-type` is the only one: the session is a
 * cookie, which is not a header the page can set and is governed by `Allow-Credentials`
 * instead. `authorization` is absent because there are no bearer tokens here and listing it
 * would advertise an authentication path that does not exist.
 */
const CABECERAS = 'content-type';

/** Ten minutes. Long enough that a working session preflights each route once, short enough
 * that a change to this list takes effect the same morning it is deployed. Chrome caps it at
 * two hours anyway. */
const MAX_AGE = '600';

export function registrarCors(app: FastifyInstance, config: ConfiguracionApi): void {
  const permitido = config.origenFrontend;

  if (permitido === '') {
    // No cross-origin frontend: this process serves the SPA and every call is same-origin.
    // Registering nothing is the right answer — a CORS hook that allows nothing still emits
    // `Vary: Origin` on every response for no reason.
    app.log.info('sin APP_ORIGEN_FRONTEND: no se habilita CORS, el frontend es del mismo origen');
    return;
  }

  app.log.info({ origen: permitido }, 'CORS habilitado para un único origen');

  app.addHook('onRequest', async (peticion, respuesta) => {
    void respuesta.header('vary', 'Origin');

    const origen = peticion.headers.origin;
    // No `Origin` at all: a same-origin request, a `curl`, or the health check. Nothing to
    // allow and nothing to refuse — CORS is a browser mechanism and this is not a browser.
    if (origen === undefined) return;

    if (origen !== permitido) {
      // No allow header, so the browser blocks it whatever we answer. A preflight is
      // short-circuited with a 403 rather than being let through to the router: it is not a
      // real request, and letting it reach the session guard would answer 401 and suggest
      // that logging in would have helped.
      if (peticion.method === 'OPTIONS') {
        peticion.log.warn({ evento: 'cors_origen_rechazado' }, 'preflight desde un origen no permitido');
        await respuesta.code(403).send({
          error: 'origen_no_permitido',
          mensaje: 'Este origen no está autorizado a usar la API.',
        });
      }
      return;
    }

    void respuesta.header('access-control-allow-origin', permitido);
    void respuesta.header('access-control-allow-credentials', 'true');

    if (peticion.method === 'OPTIONS') {
      void respuesta.header('access-control-allow-methods', METODOS);
      void respuesta.header('access-control-allow-headers', CABECERAS);
      void respuesta.header('access-control-max-age', MAX_AGE);
      await respuesta.code(204).send();
    }
  });
}
