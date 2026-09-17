/** The only safe HTTP/log boundary for Azure SQL failures. */

import type { FastifyReply, FastifyRequest } from 'fastify';

import { errorDbParaLog, numeroSql, NUMERO_SQL } from './errores.js';

export function responderErrorDb(
  peticion: FastifyRequest,
  respuesta: FastifyReply,
  e: unknown,
): void {
  const numero = numeroSql(e);
  peticion.log.error(errorDbParaLog(e), 'fallo de base de datos');

  if (numero === NUMERO_SQL.objetoInexistente) {
    void respuesta.code(503).send({
      error: 'base_sin_migrar',
      mensaje: 'La base no tiene aplicado el esquema de ControlHorario.',
    });
    return;
  }
  if (numero === NUMERO_SQL.claveForaneaOCheck) {
    void respuesta.code(409).send({
      error: 'integridad',
      mensaje: 'La operación contradice los datos actuales. Recargá y volvé a intentar.',
    });
    return;
  }
  if (numero !== undefined) {
    void respuesta.code(503).send({
      error: 'base_de_datos',
      mensaje: 'La base de datos rechazó la operación.',
    });
    return;
  }
  void respuesta.code(500).send({
    error: 'interno',
    mensaje: 'Ocurrió un error inesperado en el servidor.',
  });
}

export function noEncontrado(respuesta: FastifyReply, mensaje: string): FastifyReply {
  void respuesta.code(404).send({ error: 'no_encontrado', mensaje });
  return respuesta;
}
