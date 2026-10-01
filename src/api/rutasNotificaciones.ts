/**
 * The HTTP surface of "already notified".
 *
 *     listar(desde, hasta)   ->  GET  /api/notificaciones?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *     registrar(faltas)      ->  POST /api/notificaciones
 *
 * The Word itself is still built in the browser and never sent here. What arrives is the
 * list of (dni, fecha, tipo) keys the document covers, posted BEFORE the download: the screen
 * does not hand over a letter whose record failed.
 *
 * RRHH ONLY, both ways. An encargado cannot open Notificaciones or Indicador, so neither
 * route has a sector scope to apply; `SOLO_RRHH` refuses them in `onRequest`, before a body
 * is read, with the same 403 every other RRHH-only route gives.
 *
 * The DNIs travel in the body of the write, never in a path (see `rutasAusencias.ts`). The
 * read carries only two dates in its query string, which the request serializer strips from
 * the log line anyway.
 */

import type { FastifyInstance } from 'fastify';

import type { TipoFalta } from '../domain/fichadas/tipos.js';
import { operadorDe, SOLO_RRHH } from './autenticacion.js';
import {
  ESQUEMA_CONSULTA_NOTIFICADAS,
  ESQUEMA_CUERPO_NOTIFICADAS,
  MAX_DIAS_VENTANA_NOTIFICADAS,
} from './esquemas.js';
import type { FaltaPedida, RepositorioNotificacionesAzureSql } from './repositorioNotificaciones.js';
import { responderErrorDb } from './respuestas.js';

interface CuerpoNotificadas {
  readonly faltas: readonly { readonly dni: string; readonly fecha: string; readonly tipo: TipoFalta }[];
}

interface ConsultaNotificadas {
  readonly desde: string;
  readonly hasta: string;
}

const FECHA_INVALIDA = {
  error: 'fecha_invalida',
  mensaje: 'La fecha tiene que ser un día real, como AAAA-MM-DD.',
} as const;

const VENTANA_INVALIDA = {
  error: 'ventana_invalida',
  mensaje: `La ventana tiene que ir de una fecha a otra igual o posterior, de hasta ${MAX_DIAS_VENTANA_NOTIFICADAS} días.`,
} as const;

const MS_POR_DIA = 86_400_000;

/**
 * `YYYY-MM-DD` as a UTC-midnight Date, or `null` when it does not name a real day.
 *
 * The schema only checks the shape; `2026-02-30` passes it, and inside OPENJSON it would be a
 * conversion error — a 503 that blames the database for a typo. A round trip through
 * `Date.UTC` refuses it here instead. Exported for its test.
 */
export function fechaIsoReal(valor: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return null;
  const fecha = new Date(Date.UTC(+(m[1] as string), +(m[2] as string) - 1, +(m[3] as string)));
  return fecha.toISOString().slice(0, 10) === valor ? fecha : null;
}

/**
 * The requested keys, deduplicated in first-seen order, or `null` if any date is not a real
 * day. A letter covering the same falta twice asked for one record, not for an error.
 * Exported for its test.
 */
export function faltasPedidas(faltas: CuerpoNotificadas['faltas']): readonly FaltaPedida[] | null {
  const vistas = new Map<string, FaltaPedida>();
  for (const { dni, fecha, tipo } of faltas) {
    if (!fechaIsoReal(fecha)) return null;
    const clave = `${dni}|${fecha}|${tipo}`;
    if (!vistas.has(clave)) vistas.set(clave, { dni, fechaIso: fecha, tipo });
  }
  return [...vistas.values()];
}

export interface DependenciasNotificaciones {
  readonly repositorio: RepositorioNotificacionesAzureSql;
}

export function registrarRutasNotificaciones(
  app: FastifyInstance,
  deps: DependenciasNotificaciones,
): void {
  const { repositorio } = deps;

  app.get<{ Querystring: ConsultaNotificadas }>(
    '/api/notificaciones',
    { schema: { querystring: ESQUEMA_CONSULTA_NOTIFICADAS }, onRequest: SOLO_RRHH },
    async (peticion, respuesta) => {
      const { desde, hasta } = peticion.query;
      const inicio = fechaIsoReal(desde);
      const fin = fechaIsoReal(hasta);
      if (!inicio || !fin) return respuesta.code(400).send(FECHA_INVALIDA);
      const dias = (fin.getTime() - inicio.getTime()) / MS_POR_DIA + 1;
      if (dias < 1 || dias > MAX_DIAS_VENTANA_NOTIFICADAS) {
        return respuesta.code(400).send(VENTANA_INVALIDA);
      }

      try {
        const notificadas = await repositorio.listar(desde, hasta);
        return await respuesta.send({ notificadas });
      } catch (e: unknown) {
        responderErrorDb(peticion, respuesta, e);
        return respuesta;
      }
    },
  );

  app.post<{ Body: CuerpoNotificadas }>(
    '/api/notificaciones',
    { schema: { body: ESQUEMA_CUERPO_NOTIFICADAS }, onRequest: SOLO_RRHH },
    async (peticion, respuesta) => {
      const operador = operadorDe(peticion);
      const faltas = faltasPedidas(peticion.body.faltas);
      if (!faltas) return respuesta.code(400).send(FECHA_INVALIDA);

      try {
        const registradas = await repositorio.registrar(faltas, operador.email);
        // Counts only: no DNI, no fecha, nothing about the letter.
        peticion.log.info(
          { evento: 'faltas_notificadas', pedidas: faltas.length, registradas },
          'notificación registrada',
        );
        return await respuesta.send({ registradas });
      } catch (e: unknown) {
        responderErrorDb(peticion, respuesta, e);
        return respuesta;
      }
    },
  );
}
