/**
 * The HTTP surface of the absence registry.
 *
 *     listar()                       ->  GET /api/ausencias
 *     asignarMotivo(dni, fecha, id)  ->  PUT /api/ausencias/motivo
 *     asignarMotivos(dias, id)       ->  PUT /api/ausencias/motivos
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
 * EVERY ROUTE IS SECTOR-SCOPED. The read returns only the days of the caller's sectors, and
 * the writes refuse a day outside them with a 403. An encargado is the reason both exist, and
 * neither is a convenience for the screen: the screen never sees what it filtered out.
 *
 * THE BATCH WRITE IS ALL OR NOTHING. One unreadable date is a 400, and one day outside the
 * scope — or with no fichada — is the same 403 the single route gives, with the same body, and
 * nothing is written in either case. Refusing the request whole is what keeps the 403 from
 * becoming an oracle: a partial success would have to say which days failed.
 */

import type { FastifyInstance } from 'fastify';

import { parsearFechaDMY } from '../domain/fichadas/parseo.js';
import { alcanceDeSectores, operadorDe } from './autenticacion.js';
import type { Consultable } from './db.js';
import { ESQUEMA_CUERPO_MOTIVO_DIA, ESQUEMA_CUERPO_MOTIVOS_DIAS } from './esquemas.js';
import type { RepositorioAusenciasAzureSql } from './repositorioAusencias.js';
import { noEncontrado, responderErrorDb } from './respuestas.js';
import { permiteElDia, permiteLosDias, type DiaPedido } from './sectores.js';

interface CuerpoMotivo {
  readonly dni: string;
  /** `DD/MM/YYYY`, the raw QUICKPASS cell the screens key on. */
  readonly fecha: string;
  readonly motivoId: number | null;
}

interface CuerpoMotivos {
  readonly dias: readonly { readonly dni: string; readonly fecha: string }[];
  readonly motivoId: number | null;
}

/** The refusal both writes give, byte for byte, so the batch route cannot leak more. */
const FUERA_DE_ALCANCE = {
  error: 'fuera_de_alcance',
  mensaje: 'Ese día no pertenece a ninguno de tus sectores.',
} as const;

const FECHA_INVALIDA = {
  error: 'fecha_invalida',
  mensaje: 'La fecha tiene que venir como DD/MM/AAAA.',
} as const;

/**
 * The requested days, parsed and deduplicated, or `null` if any date is unreadable.
 *
 * Deduplicated by (dni, fechaIso) — the registry's own identity — and in first-seen order, so
 * a day named twice is written once and audited once. Exported for its test.
 */
export function diasPedidos(
  dias: readonly { readonly dni: string; readonly fecha: string }[],
): readonly DiaPedido[] | null {
  const vistos = new Map<string, DiaPedido>();
  for (const { dni, fecha } of dias) {
    const parseada = parsearFechaDMY(fecha);
    if (!parseada) return null;
    const fechaIso = parseada.toISOString().slice(0, 10);
    const clave = `${dni}|${fechaIso}`;
    if (!vistos.has(clave)) vistos.set(clave, { dni, fechaIso });
  }
  return [...vistos.values()];
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

  /**
   * The same decision as `PUT /api/ausencias/motivo`, for many days in one request.
   *
   * Every check of the single route runs, in the same order, over the whole batch before
   * anything is written: the dates are parsed by the engine's parser, the sector of every day
   * is resolved from `fichadas` in ONE query (`permiteLosDias`), and only then does the
   * repository write — one transaction, one audit row per day. An unknown motivo fails the
   * FK inside that transaction and comes back as the same 409 the single route gives.
   *
   * The answer is the rows as they now stand, the batch form of the single route's
   * `{ ausencia }`, so the screen can replace them in place without re-reading the registry.
   */
  app.put<{ Body: CuerpoMotivos }>(
    '/api/ausencias/motivos',
    { schema: { body: ESQUEMA_CUERPO_MOTIVOS_DIAS } },
    async (peticion, respuesta) => {
      const operador = operadorDe(peticion);
      const { motivoId } = peticion.body;

      const dias = diasPedidos(peticion.body.dias);
      if (!dias) return respuesta.code(400).send(FECHA_INVALIDA);
      const alcance = alcanceDeSectores(peticion);

      try {
        if (!(await permiteLosDias(pool, alcance, dias))) {
          peticion.log.warn({ evento: 'dia_fuera_de_alcance' }, 'justificación rechazada');
          return await respuesta.code(403).send(FUERA_DE_ALCANCE);
        }

        const ausencias = await repositorio.asignarMotivos(
          dias,
          motivoId,
          operador.email,
          // The same rule as the single route, for the same reason.
          operador.rol === 'encargado' ? 'encargado' : 'manual',
        );
        // Counts and codes only: no DNI, no fecha, no motivo label.
        peticion.log.info(
          {
            evento: motivoId === null ? 'motivo_quitado' : 'motivo_asignado',
            dias: ausencias.length,
          },
          'decisión registrada',
        );
        return await respuesta.send({ ausencias });
      } catch (e: unknown) {
        responderErrorDb(peticion, respuesta, e);
        return respuesta;
      }
    },
  );
}
