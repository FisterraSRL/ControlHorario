import type { FastifyInstance } from 'fastify';

import {
  ESTADOS_IRREGULARIDAD, MAX_NOTA_IRREGULARIDAD,
  type ClaveIrregularidad, type DecisionIrregularidad,
} from '../domain/cierre.js';
import { alcanceDeSectores, operadorDe, SOLO_ADMIN } from './autenticacion.js';
import { ESQUEMA_CONSULTA_NOTIFICADAS, MAX_DIAS_VENTANA_NOTIFICADAS, TIPOS_FALTA } from './esquemas.js';
import type { RepositorioCierreAzureSql } from './repositorioCierre.js';
import { responderErrorDb } from './respuestas.js';
import { fechaIsoReal } from './rutasNotificaciones.js';

const RAIZ = '/api/cierre';
const ESQUEMA_CORTE = {
  type: 'object', additionalProperties: false, required: ['dia'],
  properties: { dia: { type: 'integer', minimum: 1, maximum: 31 } },
} as const;
const ESQUEMA_REVISION = {
  type: 'object', additionalProperties: false, required: ['dni', 'fecha', 'tipo', 'decision'],
  properties: {
    dni: { type: 'string', minLength: 1, maxLength: 32 },
    fecha: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    tipo: { type: 'string', enum: TIPOS_FALTA },
    decision: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object', additionalProperties: false, required: ['estado', 'nota'],
          properties: {
            estado: { type: 'string', enum: ESTADOS_IRREGULARIDAD },
            nota: { type: 'string', maxLength: MAX_NOTA_IRREGULARIDAD },
          },
        },
      ],
    },
  },
} as const;

export function registrarRutasCierre(app: FastifyInstance, repositorio: RepositorioCierreAzureSql): void {
  app.get(`${RAIZ}/corte`, async (peticion, respuesta) => {
    try {
      return await respuesta.send({ dia: await repositorio.leerCorte() });
    } catch (error: unknown) {
      responderErrorDb(peticion, respuesta, error);
      return respuesta;
    }
  });

  app.put<{ Body: { dia: number } }>(
    `${RAIZ}/corte`, { onRequest: SOLO_ADMIN, schema: { body: ESQUEMA_CORTE } },
    async (peticion, respuesta) => {
      try {
        await repositorio.guardarCorte(peticion.body.dia, operadorDe(peticion).email);
        return await respuesta.code(204).send();
      } catch (error: unknown) {
        responderErrorDb(peticion, respuesta, error);
        return respuesta;
      }
    },
  );

  app.get<{ Querystring: { desde: string; hasta: string } }>(
    `${RAIZ}/irregularidades`, { schema: { querystring: ESQUEMA_CONSULTA_NOTIFICADAS } },
    async (peticion, respuesta) => {
      const { desde, hasta } = peticion.query;
      const inicio = fechaIsoReal(desde);
      const fin = fechaIsoReal(hasta);
      const dias = inicio && fin ? (fin.getTime() - inicio.getTime()) / 86_400_000 + 1 : 0;
      if (dias < 1 || dias > MAX_DIAS_VENTANA_NOTIFICADAS) {
        return await respuesta.code(400).send({
          error: 'ventana_invalida',
          mensaje: 'El período de consulta no es válido.',
        });
      }
      try {
        const revisiones = await repositorio.listar(desde, hasta, alcanceDeSectores(peticion));
        return await respuesta.send({ revisiones });
      } catch (error: unknown) {
        responderErrorDb(peticion, respuesta, error);
        return respuesta;
      }
    },
  );

  app.put<{ Body: ClaveIrregularidad & { decision: DecisionIrregularidad | null } }>(
    `${RAIZ}/irregularidades`, { schema: { body: ESQUEMA_REVISION } },
    async (peticion, respuesta) => {
      const { decision, dni, fecha, tipo } = peticion.body;
      const nota = decision?.nota.trim() ?? '';
      if (!fechaIsoReal(fecha) || nota.length > MAX_NOTA_IRREGULARIDAD ||
          (decision?.estado === 'justificada' && !nota)) {
        return await respuesta.code(400).send({
          error: 'revision_invalida',
          mensaje: 'Ingresá una fecha válida y un motivo para justificar la irregularidad.',
        });
      }
      try {
        const guardada = await repositorio.decidir(
          { dni, fecha, tipo },
          decision && { estado: decision.estado, nota },
          operadorDe(peticion).email,
          alcanceDeSectores(peticion),
        );
        if (!guardada) {
          return await respuesta.code(403).send({
            error: 'fuera_de_alcance',
            mensaje: 'La fichada está fuera del alcance de tu cuenta o ya no está disponible.',
          });
        }
        return await respuesta.code(204).send();
      } catch (error: unknown) {
        responderErrorDb(peticion, respuesta, error);
        return respuesta;
      }
    },
  );
}
