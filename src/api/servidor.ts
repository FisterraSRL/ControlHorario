/**
 * Building the Fastify instance: logging, validation defaults, routes, static SPA.
 *
 * Separated from `main.ts` so the whole app can be constructed without binding a port.
 *
 * ON LOGGING. This service handles DNIs, full names, and absences whose motivo can be
 * "Enfermedad". A log file gets copied into a chat window the first time something breaks,
 * so the rule here is that a log line carries counts, codes and paths, and never carries a
 * row. Concretely:
 *
 *   * request logging is a custom serializer: method and the path with the query string
 *     removed. No headers, no cookies, no body, no client address.
 *   * `POST /api/fichadas` logs six integers and nothing else.
 *   * database errors go through `errorDbParaLog`, which drops `detail` — the field where
 *     Database engines may print the values of the row that violated a constraint.
 *   * no route puts a DNI in a path, so the path a log line carries is never personal data.
 *     Identifiers travel in bodies, which are redacted. See the header of `rutasAusencias.ts`.
 *
 * ON ORDER. Three `onRequest` hooks run on this instance and Fastify runs them in
 * registration order, so the order below is behaviour and not layout:
 *
 *   1. `@fastify/cookie` parses the header. The session guard reads `request.cookies`;
 *      registered after it, every request would arrive with nothing parsed and every
 *      operator would be permanently logged out.
 *   2. `registrarCors` answers the preflight. A browser's `OPTIONS` preflight carries no
 *      cookies, so behind the guard it would 401 and the browser would refuse to send the
 *      real request — for somebody who is logged in.
 *   3. `registrarAcceso` — the guard itself. Everything under `/api/` needs a session.
 */

import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';

import { registrarAcceso } from './autenticacion.js';
import type { ConfiguracionApi } from './config.js';
import { registrarCors } from './cors.js';
import type { Pool } from './db.js';
import { errorParaLog } from './errores.js';
import { existeSpa, registrarEstatico, registrarSinSpa } from './estatico.js';
import type { LimitadorLogin } from './limitador.js';
import { crearRepositorioAdjuntos } from './repositorioAdjuntos.js';
import { crearRepositorioAusencias } from './repositorioAusencias.js';
import { crearRepositorioConfiguracion } from './repositorioConfiguracion.js';
import { crearRepositorioAzureSql } from './repositorioAzureSql.js';
import { registrarRutas } from './rutas.js';
import { registrarRutasAdjuntos } from './rutasAdjuntos.js';
import { registrarRutasAusencias } from './rutasAusencias.js';
import { registrarRutasConfiguracion } from './rutasConfiguracion.js';

/** The path without its query string. Nothing here puts personal data in a query today, and
 * this is what makes sure nothing does tomorrow either. */
function rutaSinConsulta(url: string): string {
  const corte = url.indexOf('?');
  return corte === -1 ? url : url.slice(0, corte);
}

export interface OpcionesServidor {
  /** Injected by the test suite so the login limiter's windows can be made small. */
  readonly limitador?: LimitadorLogin;
  /**
   * Routes registered BEFORE the session guard exists.
   *
   * It is here for one test, and the test is worth it. A root-level `onRequest` hook in
   * Fastify covers routes registered before it as well as after — verified, not assumed —
   * so the guard in `autenticacion.ts` does not depend on being registered first. What it
   * DOES depend on is staying at the root: wrap it in an encapsulated `register()` and it
   * silently stops covering everything outside that scope. This hook lets a test assert
   * the property from the harder side instead of trusting the current line order.
   */
  readonly rutasAntesDelGuardia?: (app: FastifyInstance) => void;
}

export async function construirServidor(
  config: ConfiguracionApi,
  pool: Pool,
  opciones: OpcionesServidor = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: config.limiteCuerpoBytes,
    logger: {
      level: config.nivelLog,
      // Defence in depth: nothing below logs headers, but if something starts to, these
      // never make it to disk.
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body', 'res.body'],
        remove: true,
      },
      serializers: {
        req(peticion: { method: string; url: string }) {
          return { metodo: peticion.method, ruta: rutaSinConsulta(peticion.url) };
        },
        res(respuesta: { statusCode: number }) {
          return { estado: respuesta.statusCode };
        },
      },
    },
    ajv: {
      customOptions: {
        // See esquemas.ts. Both of these are Fastify defaults and both of them silently
        // rewrite a request instead of rejecting it.
        removeAdditional: false,
        coerceTypes: false,
        useDefaults: false,
        allErrors: false,
        // A QUICKPASS cell is `string | number | null`, which AJV's strict mode flags as a
        // union unless told it is intentional. It is: see FILA_QUICKPASS in esquemas.ts.
        allowUnionTypes: true,
      },
    },
  });

  // Cheap, and the app is on the public internet through the tunnel.
  app.addHook('onSend', async (_peticion, respuesta, cuerpo) => {
    void respuesta.header('x-content-type-options', 'nosniff');
    void respuesta.header('referrer-policy', 'no-referrer');
    void respuesta.header('x-frame-options', 'DENY');
    return cuerpo;
  });

  /**
   * The default handler echoes `error.message` for anything with no status code, which for
   * a `pg` error is a sentence that can contain a DNI. Validation failures are the one case
   * where the message is safe and useful: AJV reports the path that failed
   * (`body/filas/3 must be object`), never the value.
   */
  app.setErrorHandler((error: FastifyError, peticion, respuesta) => {
    if (error.validation) {
      peticion.log.warn({ evento: 'cuerpo_invalido', detalle: error.message }, 'petición rechazada');
      return respuesta.code(400).send({
        error: 'cuerpo_invalido',
        mensaje: `El cuerpo de la petición no tiene la forma esperada: ${error.message}`,
      });
    }
    const estado = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (estado >= 500) {
      peticion.log.error(errorParaLog(error), 'error no manejado');
      return respuesta.code(estado).send({
        error: 'interno',
        mensaje: 'Ocurrió un error inesperado en el servidor.',
      });
    }
    peticion.log.warn({ evento: 'peticion_rechazada', estado }, 'petición rechazada');
    return respuesta.code(estado).send({ error: 'peticion_rechazada', mensaje: error.message });
  });

  await app.register(fastifyCookie);

  /**
   * Multipart is registered for the whole instance because only one route uses it and
   * scoping it would mean a plugin boundary for a single handler. `attachFieldsToBody` is
   * off: the upload streams to disk, and attaching it to the body would mean buffering a
   * medical certificate in memory first.
   */
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: config.adjuntos.maxBytes,
      files: 1,
      // dni and fecha. Anything else on this form is a client that has drifted.
      fields: 8,
      fieldSize: 1_024,
    },
  });

  /**
   * BEFORE the session guard, and that ordering is load-bearing.
   *
   * A CORS preflight is an `OPTIONS` request that a browser sends WITHOUT cookies. Behind
   * `registrarAcceso` it would answer 401, the browser would report a CORS error, and the
   * real request would never leave the page — for an operator who is logged in perfectly
   * well. Fastify runs root-level `onRequest` hooks in registration order, so this line has
   * to stay above the one below it.
   */
  registrarCors(app, config);

  opciones.rutasAntesDelGuardia?.(app);

  const { limitador } = opciones;
  await registrarAcceso(app, { config, pool, ...(limitador ? { limitador } : {}) });

  const repositorio = crearRepositorioAzureSql(pool);
  const ausencias = crearRepositorioAusencias(pool);
  const configuracion = crearRepositorioConfiguracion(pool);
  const adjuntos = crearRepositorioAdjuntos(pool, config.adjuntos.directorio);

  await registrarRutas(app, {
    config,
    pool,
    repositorio,
    ausencias,
    configuracion,
    iniciadoEn: Date.now(),
  });
  registrarRutasAusencias(app, { repositorio: ausencias });
  registrarRutasConfiguracion(app, { repositorio: configuracion });
  registrarRutasAdjuntos(app, { config, pool, repositorio: adjuntos });

  if (await existeSpa(config.directorioEstatico)) {
    await registrarEstatico(app, config.directorioEstatico);
    app.log.info({ directorio: config.directorioEstatico }, 'sirviendo el frontend');
  } else {
    registrarSinSpa(app, config.directorioEstatico);
    app.log.warn(
      { directorio: config.directorioEstatico },
      'no hay index.html: el servidor arranca solo como API',
    );
  }

  return app;
}
