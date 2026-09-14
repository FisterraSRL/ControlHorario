/**
 * The one way a failure leaves this server.
 *
 * Extracted from `rutas.ts` when the API grew past three endpoints, unchanged in behaviour:
 * the body never quotes the database and never quotes the request. A Postgres error message
 * can contain the values of the row that broke a constraint, and in this schema those
 * values are DNIs — the `ausencias_rrhh_gana()` trigger of migration 001 prints one.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

import { codigoPg, CODIGO_PG, errorDbParaLog } from './errores.js';

export function responderErrorDb(
  peticion: FastifyRequest,
  respuesta: FastifyReply,
  e: unknown,
): void {
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
  if (codigo === CODIGO_PG.claveForanea) {
    // In this schema a foreign key failure from a screen means one thing: the day being
    // written about is not in `fichadas`. Saying so is useful and gives nothing away.
    void respuesta.code(409).send({
      error: 'dia_sin_evidencia',
      mensaje:
        'Ese día no está en el historial de fichadas. Puede que se haya vaciado o vuelto a ' +
        'cargar el período mientras tenías la pantalla abierta: recargá y volvé a intentar.',
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

/** `404` with the same shape every other error has. */
export function noEncontrado(respuesta: FastifyReply, mensaje: string): FastifyReply {
  void respuesta.code(404).send({ error: 'no_encontrado', mensaje });
  return respuesta;
}
