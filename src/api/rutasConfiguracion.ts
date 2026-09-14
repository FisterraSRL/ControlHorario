/**
 * The HTTP surface of Configuración.
 *
 *     GET    /api/configuracion                  everything the screen renders, in one read
 *     PATCH  /api/configuracion/parametros       breakMax, tolerancia, horas de turno
 *     PUT    /api/configuracion/sectores         fichadas required for one sector
 *     POST   /api/configuracion/motivos          add a motivo
 *     PATCH  /api/configuracion/motivos/:id      toggle its `worked` flag
 *     DELETE /api/configuracion/motivos/:id      retire it (activo = false; never a DELETE)
 *     POST   /api/configuracion/exclusiones      exclude a person
 *     DELETE /api/configuracion/exclusiones      stop excluding them
 *
 * A motivo id is a surrogate integer and may live in the path. A DNI may not — see the
 * header of `rutasAusencias.ts` — so both exclusion routes take a body.
 *
 * Every write answers with the part of the configuration it changed, so the screen re-renders
 * from the server's copy rather than from its own optimistic guess. Two operators editing the
 * tolerancia at the same time is not a race anybody will notice on a three-person tool, but
 * a screen that shows a value the server rejected is a screen that lies.
 */

import type { FastifyInstance } from 'fastify';

import { operadorDe } from './autenticacion.js';
import {
  ESQUEMA_CUERPO_BAJA_EXCLUSION,
  ESQUEMA_CUERPO_EXCLUSION,
  ESQUEMA_CUERPO_MOTIVO_EDITADO,
  ESQUEMA_CUERPO_MOTIVO_NUEVO,
  ESQUEMA_CUERPO_PARAMETROS,
  ESQUEMA_CUERPO_SECTOR_REGLA,
} from './esquemas.js';
import type {
  ParametrosConfiguracion,
  RepositorioConfiguracionPostgres,
} from './repositorioConfiguracion.js';
import { noEncontrado, responderErrorDb } from './respuestas.js';

export interface DependenciasConfiguracion {
  readonly repositorio: RepositorioConfiguracionPostgres;
}

interface ParamsId {
  readonly id: string;
}

/** The path parameter is a string; anything that is not a positive integer is a 404. */
function idValido(crudo: string): number | null {
  if (!/^\d{1,9}$/.test(crudo)) return null;
  const n = Number(crudo);
  return n > 0 ? n : null;
}

export function registrarRutasConfiguracion(
  app: FastifyInstance,
  deps: DependenciasConfiguracion,
): void {
  const { repositorio } = deps;

  app.get('/api/configuracion', async (peticion, respuesta) => {
    try {
      return await respuesta.send(await repositorio.leer());
    } catch (e: unknown) {
      responderErrorDb(peticion, respuesta, e);
      return respuesta;
    }
  });

  app.patch<{ Body: Partial<ParametrosConfiguracion> }>(
    '/api/configuracion/parametros',
    { schema: { body: ESQUEMA_CUERPO_PARAMETROS } },
    async (peticion, respuesta) => {
      const operador = operadorDe(peticion);
      try {
        const parametros = await repositorio.guardarParametros(peticion.body, operador.email);
        peticion.log.info({ evento: 'config_actualizada' }, 'parámetros guardados');
        return await respuesta.send({ parametros });
      } catch (e: unknown) {
        responderErrorDb(peticion, respuesta, e);
        return respuesta;
      }
    },
  );

  app.put<{ Body: { sector: string; fichadasRequeridas: number } }>(
    '/api/configuracion/sectores',
    { schema: { body: ESQUEMA_CUERPO_SECTOR_REGLA } },
    async (peticion, respuesta) => {
      const operador = operadorDe(peticion);
      try {
        const reglasSector = await repositorio.guardarReglaSector(
          peticion.body.sector,
          peticion.body.fichadasRequeridas,
          operador.email,
        );
        peticion.log.info({ evento: 'sector_regla_actualizada' }, 'regla de sector guardada');
        return await respuesta.send({ reglasSector });
      } catch (e: unknown) {
        responderErrorDb(peticion, respuesta, e);
        return respuesta;
      }
    },
  );

  app.post<{ Body: { label: string; worked: boolean } }>(
    '/api/configuracion/motivos',
    { schema: { body: ESQUEMA_CUERPO_MOTIVO_NUEVO } },
    async (peticion, respuesta) => {
      const operador = operadorDe(peticion);
      try {
        const motivo = await repositorio.crearMotivo(
          peticion.body.label,
          peticion.body.worked,
          operador.email,
        );
        peticion.log.info({ evento: 'motivo_creado' }, 'motivo agregado');
        return await respuesta.code(201).send({ motivo });
      } catch (e: unknown) {
        responderErrorDb(peticion, respuesta, e);
        return respuesta;
      }
    },
  );

  app.patch<{ Params: ParamsId; Body: { worked: boolean } }>(
    '/api/configuracion/motivos/:id',
    { schema: { body: ESQUEMA_CUERPO_MOTIVO_EDITADO } },
    async (peticion, respuesta) => {
      const operador = operadorDe(peticion);
      const id = idValido(peticion.params.id);
      if (id === null) return noEncontrado(respuesta, 'No existe ese motivo.');
      try {
        const motivo = await repositorio.editarMotivo(id, peticion.body.worked, operador.email);
        if (!motivo) return noEncontrado(respuesta, 'No existe ese motivo.');
        return await respuesta.send({ motivo });
      } catch (e: unknown) {
        responderErrorDb(peticion, respuesta, e);
        return respuesta;
      }
    },
  );

  /**
   * Retire, not delete. `motivos.id` is referenced by `ausencias` and `respuestas` with
   * `ON DELETE RESTRICT`: a real DELETE would either fail, or — if the motivo had never
   * been used — quietly break the assumption that a decision's motivo can always be read
   * back. `activo = false` takes it out of the dropdown and leaves the history legible.
   */
  app.delete<{ Params: ParamsId }>(
    '/api/configuracion/motivos/:id',
    async (peticion, respuesta) => {
      const operador = operadorDe(peticion);
      const id = idValido(peticion.params.id);
      if (id === null) return noEncontrado(respuesta, 'No existe ese motivo.');
      try {
        const retirado = await repositorio.retirarMotivo(id, operador.email);
        if (!retirado) return noEncontrado(respuesta, 'No existe ese motivo, o ya estaba retirado.');
        peticion.log.info({ evento: 'motivo_retirado' }, 'motivo retirado');
        return await respuesta.code(204).send();
      } catch (e: unknown) {
        responderErrorDb(peticion, respuesta, e);
        return respuesta;
      }
    },
  );

  app.post<{ Body: { dni: string; motivoTexto?: string } }>(
    '/api/configuracion/exclusiones',
    { schema: { body: ESQUEMA_CUERPO_EXCLUSION } },
    async (peticion, respuesta) => {
      const operador = operadorDe(peticion);
      try {
        const exclusion = await repositorio.agregarExclusion(
          peticion.body.dni,
          peticion.body.motivoTexto ?? null,
          operador.email,
        );
        peticion.log.info({ evento: 'exclusion_agregada' }, 'exclusión agregada');
        return await respuesta.code(201).send({ exclusion });
      } catch (e: unknown) {
        responderErrorDb(peticion, respuesta, e);
        return respuesta;
      }
    },
  );

  app.delete<{ Body: { dni: string } }>(
    '/api/configuracion/exclusiones',
    { schema: { body: ESQUEMA_CUERPO_BAJA_EXCLUSION } },
    async (peticion, respuesta) => {
      const operador = operadorDe(peticion);
      try {
        const quitada = await repositorio.quitarExclusion(peticion.body.dni, operador.email);
        if (!quitada) return noEncontrado(respuesta, 'Esa persona no estaba en la lista.');
        peticion.log.info({ evento: 'exclusion_quitada' }, 'exclusión quitada');
        return await respuesta.code(204).send();
      } catch (e: unknown) {
        responderErrorDb(peticion, respuesta, e);
        return respuesta;
      }
    },
  );
}
