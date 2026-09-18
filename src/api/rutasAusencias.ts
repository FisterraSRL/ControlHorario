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
 *
 * BOTH ROUTES ARE SECTOR-SCOPED. The read returns only the days of the caller's sectors, and
 * the write refuses a day outside them with a 403. An encargado is the reason both exist, and
 * neither is a convenience for the screen: the screen never sees what it filtered out.
 */

import type { FastifyInstance } from 'fastify';

import { parsearFechaDMY } from '../domain/fichadas/parseo.js';
import { alcanceDeSectores, operadorDe } from './autenticacion.js';
import type { Consultable } from './db.js';
import { ESQUEMA_CUERPO_MOTIVO_DIA } from './esquemas.js';
import type { RepositorioAusenciasAzureSql } from './repositorioAusencias.js';
import { noEncontrado, responderErrorDb } from './respuestas.js';
import { permiteElDia } from './sectores.js';

interface CuerpoMotivo {
  readonly dni: string;
  /** `DD/MM/YYYY`, the raw QUICKPASS cell the screens key on. */
  readonly fecha: string;
  readonly motivoId: number | null;
}

export interface DependenciasAusencias {
  readonly repositorio: RepositorioAusenciasAzureSql;
  /** Used only to resolve the sector of the day a write claims to be about. */
  readonly pool: Consultable;
}

export function registrarRutasAusencias(
  app: FastifyInstance,
  deps: DependenciasAusencias,
): void {
  const { repositorio, pool } = deps;

  app.get('/api/ausencias', async (peticion, respuesta) => {
    try {
      const ausencias = await repositorio.listar(alcanceDeSectores(peticion));
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
      const alcance = alcanceDeSectores(peticion);

      try {
        /**
         * THE AUTHORISATION, AND IT IS RESOLVED FROM `fichadas`, NOT FROM THE REQUEST.
         *
         * The body says which day this is about, and a body is whatever the client typed. So
         * the sector of that exact (dni, fecha) is read from the evidence and checked against
         * the caller's scope before anything is written. A day with no fichada at all is
         * refused by the same branch: it cannot be placed in any sector, so it cannot be
         * placed in this one.
         *
         * 403 and not 404, and the same body either way: whether the day exists is precisely
         * what a supervisor of another sector is not entitled to learn from this endpoint.
         */
        if (!(await permiteElDia(pool, alcance, dni, fechaIso))) {
          peticion.log.warn({ evento: 'dia_fuera_de_alcance' }, 'justificación rechazada');
          return await respuesta.code(403).send({
            error: 'fuera_de_alcance',
            mensaje: 'Ese día no pertenece a ninguno de tus sectores.',
          });
        }

        const ausencia = await repositorio.asignarMotivo(
          dni,
          fechaIso,
          motivoId,
          operador.email,
          // Read from the role and not from `alcance`: today only an encargado is scoped, so
          // the two agree, and a day where they stopped agreeing would be a day this row
          // started lying about who decided.
          operador.rol === 'encargado' ? 'encargado' : 'manual',
        );
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
