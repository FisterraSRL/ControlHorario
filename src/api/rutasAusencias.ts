/**
 * The HTTP surface of the absence registry.
 *
 *     listar()                       ->  GET /api/ausencias
 *     asignarMotivo(dni, fecha, id)  ->  PUT /api/ausencias/motivo
 *
 * THE DNI IS IN THE BODY AND NOT IN THE PATH. It would read better as
 * `PUT /api/ausencias/30111222/2026-01-05/motivo`, and that URL is a DNI written into the
 * request log line, into any proxy in front, and into the browser's own history. The
 * request serializer in `servidor.ts` strips the query string for exactly this reason and
 * cannot strip a path; a body is redacted wholesale. So the identifier travels in the body,
 * and the only things that ever appear in a path here are surrogate integer ids.
 *
 * There is no `POST /api/ausencias`. A registry row is never created by hand: it exists
 * because the engine computed that day as an absence during an upload. See
 * `repositorioAusencias.ts`.
 */

import type { FastifyInstance } from 'fastify';

import { parsearFechaDMY } from '../domain/fichadas/parseo.js';
import { operadorDe } from './autenticacion.js';
import { ESQUEMA_CUERPO_MOTIVO_DIA } from './esquemas.js';
import type { RepositorioAusenciasAzureSql } from './repositorioAusencias.js';
import { noEncontrado, responderErrorDb } from './respuestas.js';

interface CuerpoMotivo {
  readonly dni: string;
  /** `DD/MM/YYYY`, the raw QUICKPASS cell the screens key on. */
  readonly fecha: string;
  readonly motivoId: number | null;
}

export interface DependenciasAusencias {
  readonly repositorio: RepositorioAusenciasAzureSql;
}

export function registrarRutasAusencias(
  app: FastifyInstance,
  deps: DependenciasAusencias,
): void {
  const { repositorio } = deps;

  app.get('/api/ausencias', async (peticion, respuesta) => {
    try {
      const ausencias = await repositorio.listar();
      return await respuesta.send({ ausencias });
    } catch (e: unknown) {
      responderErrorDb(peticion, respuesta, e);
      return respuesta;
    }
  });

  app.put<{ Body: CuerpoMotivo }>(
    '/api/ausencias/motivo',
    { schema: { body: ESQUEMA_CUERPO_MOTIVO_DIA } },
    async (peticion, respuesta) => {
      const operador = operadorDe(peticion);
      const { dni, fecha, motivoId } = peticion.body;

      /**
       * The screen speaks `DD/MM/YYYY` because that is what the QUICKPASS cell says and
       * what `RegistroDia.fechaStr` carries. Azure SQL speaks DATE. `parsearFechaDMY` is the
       * engine's own parser, imported rather than reimplemented, so "a date this API
       * accepts" and "a date the engine can read" are the same set by construction.
       */
      const parseada = parsearFechaDMY(fecha);
      if (!parseada) {
        return respuesta.code(400).send({
          error: 'fecha_invalida',
          mensaje: 'La fecha tiene que venir como DD/MM/AAAA.',
        });
      }
      const fechaIso = parseada.toISOString().slice(0, 10);

      try {
        const ausencia = await repositorio.asignarMotivo(dni, fechaIso, motivoId, operador.email);
        if (!ausencia) {
          return noEncontrado(respuesta, 'No se encontró ese día en el registro de ausencias.');
        }
        // Counts and codes only: no DNI, no fecha, no motivo label.
        peticion.log.info(
          { evento: motivoId === null ? 'motivo_quitado' : 'motivo_asignado' },
          'decisión registrada',
        );
        return await respuesta.send({ ausencia });
      } catch (e: unknown) {
        responderErrorDb(peticion, respuesta, e);
        return respuesta;
      }
    },
  );
}
