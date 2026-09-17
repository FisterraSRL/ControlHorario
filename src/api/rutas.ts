/**
 * The evidence endpoints, and `/health`.
 *
 *     listar()          ->  GET    /api/fichadas
 *     upsert(filas)     ->  POST   /api/fichadas
 *     vaciar()          ->  DELETE /api/fichadas
 *
 * plus `/health`, which is for the person on call, not for the app.
 *
 * The decision endpoints — ausencias, configuración, adjuntos — live in their own
 * `rutas*.ts` files next to this one. Solicitudes and notificaciones still have none:
 * those tables exist because slice 3 needs them, and an endpoint written now against a
 * screen that does not exist yet is a guess that has to be un-guessed later.
 *
 * THE UPLOAD DOES TWO THINGS. It writes the evidence, and then it re-derives the absence
 * registry from it — the port of the legacy `recompute()`, which called
 * `syncAusenciasHistorial()` and `pruneStaleAusencias()` on every load. See
 * `repositorioAusencias.ts` for why that cannot be a view.
 *
 * NO RESPONSE SCHEMA ON `GET /api/fichadas`. Fastify serialises through the response schema
 * and strips anything the schema does not mention — which would quietly delete every
 * QUICKPASS column this app does not read on the way out, from the one payload whose entire
 * purpose is to be complete. The rows are serialised as-is.
 */

import type { FastifyInstance } from 'fastify';

import type { FilaQuickpass } from '../domain/fichadas/tipos.js';
import { operadorDe } from './autenticacion.js';
import type { ConfiguracionApi } from './config.js';
import { errorDbParaLog } from './errores.js';
import { contarMigracionesAplicadas } from './migraciones.js';
import { ESQUEMA_CUERPO_UPSERT } from './esquemas.js';
import { ESQUEMA, type Pool } from './db.js';
import type { RepositorioAusenciasAzureSql } from './repositorioAusencias.js';
import type { RepositorioConfiguracionAzureSql } from './repositorioConfiguracion.js';
import type { RepositorioFichadasAzureSql } from './repositorioAzureSql.js';
import { responderErrorDb } from './respuestas.js';

/**
 * `cargas.archivo` is NOT NULL and it should hold the name of the spreadsheet. The port
 * does not carry it: `upsert(filas)` receives rows and nothing else, and `CargaContainer`
 * — which does know the filename — hands over `planilla.filas` alone. Widening the port is
 * the fix, and it is a deliberate non-goal of this slice; inventing a plausible-looking
 * filename here would be worse than recording that nobody told us. See docs/stack-local.md,
 * section 11.
 *
 * `cargas.subido_por` no longer has this problem: it is the email of the operator whose
 * session made the request.
 */
const ARCHIVO_NO_INFORMADO = '(no informado por el cliente)';

interface CuerpoUpsert {
  readonly filas: readonly FilaQuickpass[];
}

export interface DependenciasRutas {
  readonly config: ConfiguracionApi;
  readonly pool: Pool;
  readonly repositorio: RepositorioFichadasAzureSql;
  readonly ausencias: RepositorioAusenciasAzureSql;
  readonly configuracion: RepositorioConfiguracionAzureSql;
  /** Set once at boot so `/health` can report it without a query. */
  readonly iniciadoEn: number;
}

export async function registrarRutas(
  app: FastifyInstance,
  deps: DependenciasRutas,
): Promise<void> {
  const { config, pool, repositorio, ausencias, configuracion, iniciadoEn } = deps;

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
        // The schema everything of ours lives in. Reported because the database is shared
        // with two other projects: "is it pointed at the right place" has to be answerable
        // with one curl, and `migracionesAplicadas` counts rows in THIS schema's ledger.
        esquema: ESQUEMA,
        // Encryption and certificate validation are hard-coded in db.ts.
        tls: true,
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
      const operador = operadorDe(peticion);
      try {
        const resultado = await repositorio.upsert(peticion.body.filas, {
          archivo: ARCHIVO_NO_INFORMADO,
          subidoPor: operador.email,
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

        /**
         * Re-derive the registry from the WHOLE historial, not from the rows just uploaded.
         *
         * That is what the legacy `recompute()` did, and it is what makes a rule fix
         * retroactive: deploy a corrected engine, upload anything, and every day in the
         * history is re-evaluated in the same pass. It also means a re-upload that turns an
         * absence into a worked day prunes the orphaned registry row — conservatively; see
         * `repositorioAusencias.ts`.
         *
         * A failure here is NOT a failed upload. The evidence is committed and the operator
         * must not be told otherwise; the registry is derived and the next upload rebuilds
         * it. So it is logged and the 200 stands.
         */
        try {
          const cfg = await configuracion.paraElMotor();
          const filas = await repositorio.listar();
          const sincronizacion = await ausencias.sincronizar(filas, cfg, operador.email);
          peticion.log.info({ evento: 'ausencias_sincronizadas', ...sincronizacion }, 'registro de ausencias al día');
        } catch (e: unknown) {
          peticion.log.error(errorDbParaLog(e), 'no se pudo sincronizar el registro de ausencias');
        }

        return await respuesta.send(resultado);
      } catch (e: unknown) {
        responderErrorDb(peticion, respuesta, e);
        return respuesta;
      }
    },
  );

  app.delete('/api/fichadas', async (peticion, respuesta) => {
    const operador = operadorDe(peticion);
    try {
      const borradas = await repositorio.vaciar(operador.email);
      peticion.log.warn({ evento: 'vaciar_historial', borradas }, 'historial vaciado');
      return await respuesta.code(204).send();
    } catch (e: unknown) {
      responderErrorDb(peticion, respuesta, e);
      return respuesta;
    }
  });
}
