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
 *     Postgres prints the values of the row that violated a constraint.
 */

import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';

import type { ConfiguracionApi } from './config.js';
import type { Pool } from './db.js';
import { errorParaLog } from './errores.js';
import { existeSpa, registrarEstatico, registrarSinSpa } from './estatico.js';
import { crearRepositorioPostgres } from './repositorioPostgres.js';
import { registrarRutas } from './rutas.js';

/** The path without its query string. Nothing here puts personal data in a query today, and
 * this is what makes sure nothing does tomorrow either. */
function rutaSinConsulta(url: string): string {
  const corte = url.indexOf('?');
  return corte === -1 ? url : url.slice(0, corte);
}

export async function construirServidor(
  config: ConfiguracionApi,
  pool: Pool,
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

  const repositorio = crearRepositorioPostgres(pool);
  await registrarRutas(app, { config, pool, repositorio, iniciadoEn: Date.now() });

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
