/**
 * The HTTP surface.
 *
 * It is `RepositorioFichadas` and nothing else:
 *
 *     listar()          ->  GET    /api/fichadas
 *     upsert(filas)     ->  POST   /api/fichadas
 *     vaciar()          ->  DELETE /api/fichadas
 *
 * plus `/health`, which is for the person on call, not for the app.
 *
 * There is no endpoint for ausencias, motivos, solicitudes or notificaciones. Those tables
 * exist in the schema because slices 2 and 3 need them, and an endpoint written now against
 * a screen that does not exist yet is a guess that has to be un-guessed later.
 *
 * NO RESPONSE SCHEMA ON `GET /api/fichadas`. Fastify serialises through the response schema
 * and strips anything the schema does not mention — which would quietly delete every
 * QUICKPASS column this app does not read on the way out, from the one payload whose entire
 * purpose is to be complete. The rows are serialised as-is.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { FilaQuickpass } from '../domain/fichadas/tipos.js';
import type { ConfiguracionApi } from './config.js';
import { codigoPg, CODIGO_PG, errorDbParaLog } from './errores.js';
import { contarMigracionesAplicadas } from './migraciones.js';
import { ESQUEMA_CUERPO_UPSERT } from './esquemas.js';
import type { Pool } from './db.js';
import type { RepositorioFichadasPostgres } from './repositorioPostgres.js';

/**
 * `cargas.archivo` is NOT NULL and it should hold the name of the spreadsheet. The port
 * does not carry it: `upsert(filas)` receives rows and nothing else, and `CargaContainer`
 * — which does know the filename — hands over `planilla.filas` alone. Widening the port is
 * the fix, and it is a deliberate non-goal of this slice; inventing a plausible-looking
 * filename here would be worse than recording that nobody told us. See docs/servidor.md,
 * section 11.
 */
const ARCHIVO_NO_INFORMADO = '(no informado por el cliente)';

interface CuerpoUpsert {
  readonly filas: readonly FilaQuickpass[];
}

export interface DependenciasRutas {
  readonly config: ConfiguracionApi;
  readonly pool: Pool;
  readonly repositorio: RepositorioFichadasPostgres;
  /** Set once at boot so `/health` can report it without a query. */
  readonly iniciadoEn: number;
}

/**
 * Every failure that reaches the client is one of these. The body never quotes the
 * database, and never quotes the request: a Postgres error message can contain the values
 * of the row that broke a constraint, and those values are DNIs.
 */
function responderErrorDb(peticion: FastifyRequest, respuesta: FastifyReply, e: unknown): void {
  const codigo = codigoPg(e);
  peticion.log.error(errorDbParaLog(e), 'fallo de base de datos');

  if (codigo === CODIGO_PG.tablaInexistente) {
    void respuesta.code(503).send({
      error: 'base_sin_migrar',
      mensaje:
        'La base de datos no tiene el esquema aplicado. Corré las migraciones ' +
        '(docs/servidor.md, "Aplicar las migraciones").',
    });
    return;
  }
  if (codigo !== undefined) {
    void respuesta.code(503).send({
      error: 'base_de_datos',
      mensaje: 'La base de datos rechazó la operación. Revisá los logs del contenedor api.',
    });
    return;
  }
  void respuesta.code(500).send({
    error: 'interno',
    mensaje: 'Ocurrió un error inesperado en el servidor.',
  });
}

export async function registrarRutas(
  app: FastifyInstance,
  deps: DependenciasRutas,
): Promise<void> {
  const { config, pool, repositorio, iniciadoEn } = deps;

  /**
   * The one thing to curl at 23:00. 200 means the API is up AND the database answered;
   * 503 means the API is up and the database is not, which is a different problem with a
   * different fix, and the status code says which without reading the body.
   */
  app.get('/health', async (_peticion, respuesta) => {
    const inicio = Date.now();
    const alcanzable = await repositorio.alcanzable();
    const latenciaMs = Date.now() - inicio;
    const migraciones = alcanzable ? await contarMigracionesAplicadas(pool) : null;

    const cuerpo = {
      ok: alcanzable,
      servicio: 'controlhorario-api',
      uptimeS: Math.round((Date.now() - iniciadoEn) / 1000),
      // What the server believes its public address is. Reported so that "the link in the
      // email is wrong" can be answered with one curl instead of a guess. Empty means
      // APP_URL_PUBLICA was never set.
      urlPublica: config.urlPublica,
      baseDeDatos: {
        alcanzable,
        latenciaMs,
        host: config.baseDeDatos.host,
        base: config.baseDeDatos.base,
        // null means the ledger table is not there: the migrations were never applied.
        migracionesAplicadas: migraciones,
      },
    };
    return respuesta.code(alcanzable ? 200 : 503).send(cuerpo);
  });

  app.get('/api/fichadas', async (peticion, respuesta) => {
    try {
      const filas = await repositorio.listar();
      return await respuesta.send({ filas });
    } catch (e: unknown) {
      responderErrorDb(peticion, respuesta, e);
      return respuesta;
    }
  });

  app.post<{ Body: CuerpoUpsert }>(
    '/api/fichadas',
    { schema: { body: ESQUEMA_CUERPO_UPSERT } },
    async (peticion, respuesta) => {
      try {
        const resultado = await repositorio.upsert(peticion.body.filas, {
          archivo: ARCHIVO_NO_INFORMADO,
          subidoPor: config.operador,
        });
        // Counts only. Nothing about who or which day is in this line.
        peticion.log.info(
          {
            evento: 'carga',
            recibidas: resultado.recibidas,
            descartadas: resultado.descartadas,
            nuevas: resultado.nuevas,
            actualizadas: resultado.actualizadas,
            sinCambios: resultado.sinCambios,
            totalHistorial: resultado.totalHistorial,
          },
          'carga aplicada',
        );
        return await respuesta.send(resultado);
      } catch (e: unknown) {
        responderErrorDb(peticion, respuesta, e);
        return respuesta;
      }
    },
  );

  app.delete('/api/fichadas', async (peticion, respuesta) => {
    try {
      const borradas = await repositorio.vaciar(config.operador);
      peticion.log.warn({ evento: 'vaciar_historial', borradas }, 'historial vaciado');
      return await respuesta.code(204).send();
    } catch (e: unknown) {
      responderErrorDb(peticion, respuesta, e);
      return respuesta;
    }
  });
}
