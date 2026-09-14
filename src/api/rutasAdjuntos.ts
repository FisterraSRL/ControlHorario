/**
 * The HTTP surface of the attachments.
 *
 *     GET    /api/adjuntos              every attachment's metadata
 *     POST   /api/adjuntos              multipart upload: dni, fecha, file
 *     GET    /api/adjuntos/:id/archivo  the bytes, behind the session
 *     DELETE /api/adjuntos/:id          remove the row and the file
 *
 * THE DOWNLOAD ROUTE IS THE WHOLE REASON THIS FILE EXISTS SEPARATELY FROM `estatico.ts`.
 * `@fastify/static` serves `dist/` because `dist/` is a JavaScript bundle and a logo. These
 * files are medical certificates, and the difference is not a policy, it is three lines:
 *
 *   1. the request goes through the session hook like every other `/api/` route;
 *   2. the response says `Content-Disposition: attachment`, so the browser saves it instead
 *      of rendering it — an inline PDF or image is one that a screen-sharing call, a
 *      preview pane or a misclick puts in front of somebody who should not see it;
 *   3. the response says `application/octet-stream` rather than the real type, so nothing
 *      downstream decides to be helpful and render it anyway. `x-content-type-options:
 *      nosniff` is already set globally in `servidor.ts`.
 *
 * The filename in the header is the operator's original name — percent-encoded through
 * `filename*`, which is the only place it is ever emitted, and it never touches a path.
 */

import { createReadStream } from 'node:fs';

import type { FastifyInstance } from 'fastify';

import { parsearFechaDMY } from '../domain/fichadas/parseo.js';
import { operadorDe } from './autenticacion.js';
import { auditar, idDeDia } from './auditoria.js';
import type { ConfiguracionApi } from './config.js';
import { LIMITES_CAMPO_ADJUNTO } from './esquemas.js';
import type { Pool } from './db.js';
import { ErrorAdjunto, type RepositorioAdjuntosPostgres } from './repositorioAdjuntos.js';
import { noEncontrado, responderErrorDb } from './respuestas.js';

export interface DependenciasAdjuntos {
  readonly config: ConfiguracionApi;
  readonly pool: Pool;
  readonly repositorio: RepositorioAdjuntosPostgres;
}

interface ParamsId {
  readonly id: string;
}

function idValido(crudo: string): number | null {
  if (!/^\d{1,15}$/.test(crudo)) return null;
  const n = Number(crudo);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * RFC 5987 `filename*`, and only `filename*`.
 *
 * The plain `filename=` parameter cannot carry a non-ASCII character, and an accent in a
 * certificate's name is the norm rather than the exception here. Emitting both would mean
 * emitting a lossy ASCII fallback built by stripping characters out of the operator's
 * string — a second, different name for the same file, and a second place a quote or a
 * newline could break out of the header. One encoded parameter, no fallback.
 */
function cabeceraNombre(nombre: string): string {
  const limpio = nombre.replace(/[\r\n]/g, ' ').slice(0, LIMITES_CAMPO_ADJUNTO.maxNombre);
  return `attachment; filename*=UTF-8''${encodeURIComponent(limpio)}`;
}

export function registrarRutasAdjuntos(
  app: FastifyInstance,
  deps: DependenciasAdjuntos,
): void {
  const { config, pool, repositorio } = deps;

  app.get('/api/adjuntos', async (peticion, respuesta) => {
    try {
      const adjuntos = await repositorio.listar();
      return await respuesta.send({ adjuntos });
    } catch (e: unknown) {
      responderErrorDb(peticion, respuesta, e);
      return respuesta;
    }
  });

  /**
   * Upload.
   *
   * `peticion.file()` streams: the bytes go from the socket to the disk without the whole
   * file existing in memory, which is what makes the size limit a limit on the disk rather
   * than on the heap. The two text fields arrive before the file part because the client
   * appends them first; `file.fields` exposes them either way.
   */
  app.post('/api/adjuntos', async (peticion, respuesta) => {
    const operador = operadorDe(peticion);

    if (!peticion.isMultipart()) {
      return respuesta.code(415).send({
        error: 'formato_invalido',
        mensaje: 'El archivo tiene que enviarse como multipart/form-data.',
      });
    }

    try {
      const parte = await peticion.file({ limits: { fileSize: config.adjuntos.maxBytes } });
      if (!parte) {
        return respuesta.code(400).send({
          error: 'sin_archivo',
          mensaje: 'No llegó ningún archivo.',
        });
      }

      const campos = parte.fields as Record<string, { value?: unknown } | undefined>;
      const dni = String(campos['dni']?.value ?? '').trim();
      const fechaCruda = String(campos['fecha']?.value ?? '').trim();

      if (!dni || dni.length > LIMITES_CAMPO_ADJUNTO.maxDni) {
        return respuesta.code(400).send({
          error: 'dia_invalido',
          mensaje: 'Falta el DNI de la persona a la que corresponde el archivo.',
        });
      }
      const fecha = parsearFechaDMY(fechaCruda);
      if (!fecha) {
        return respuesta.code(400).send({
          error: 'fecha_invalida',
          mensaje: 'La fecha tiene que venir como DD/MM/AAAA.',
        });
      }

      const nombre = (parte.filename || 'adjunto').slice(0, LIMITES_CAMPO_ADJUNTO.maxNombre);

      const adjunto = await repositorio.guardar(
        {
          dni,
          fecha: fecha.toISOString().slice(0, 10),
          nombre,
          tipoMime: parte.mimetype,
          flujo: parte.file,
          truncado: () => parte.file.truncated,
        },
        config.adjuntos.maxBytes,
        operador.email,
      );

      // Size and type. Not the filename, and not the DNI.
      peticion.log.info(
        { evento: 'adjunto_subido', bytes: adjunto.bytes, tipo: adjunto.tipoMime },
        'adjunto guardado',
      );
      return await respuesta.code(201).send({ adjunto });
    } catch (e: unknown) {
      if (e instanceof ErrorAdjunto) {
        return respuesta.code(e.estado).send({ error: 'adjunto_rechazado', mensaje: e.message });
      }
      responderErrorDb(peticion, respuesta, e);
      return respuesta;
    }
  });

  app.get<{ Params: ParamsId }>('/api/adjuntos/:id/archivo', async (peticion, respuesta) => {
    const operador = operadorDe(peticion);
    const id = idValido(peticion.params.id);
    if (id === null) return noEncontrado(respuesta, 'No existe ese adjunto.');

    try {
      const abierto = await repositorio.abrir(id);
      if (!abierto) return noEncontrado(respuesta, 'No existe ese adjunto.');

      // Reading a medical certificate is itself a thing worth being able to prove later.
      await auditar(pool, {
        actor: operador.email,
        accion: 'adjunto_descargado',
        entidad: 'adjuntos',
        entidadId: idDeDia(abierto.adjunto.dni, abierto.adjunto.fecha),
        datos: { adjuntoId: id },
      });

      return await respuesta
        .header('content-type', 'application/octet-stream')
        .header('content-disposition', cabeceraNombre(abierto.adjunto.nombre))
        .header('content-length', String(abierto.bytes))
        // Never in a shared cache, never on disk in a proxy, never in the back/forward cache.
        .header('cache-control', 'no-store, private')
        .send(createReadStream(abierto.ruta));
    } catch (e: unknown) {
      if (e instanceof ErrorAdjunto) {
        return respuesta.code(e.estado).send({ error: 'adjunto_rechazado', mensaje: e.message });
      }
      responderErrorDb(peticion, respuesta, e);
      return respuesta;
    }
  });

  app.delete<{ Params: ParamsId }>('/api/adjuntos/:id', async (peticion, respuesta) => {
    const operador = operadorDe(peticion);
    const id = idValido(peticion.params.id);
    if (id === null) return noEncontrado(respuesta, 'No existe ese adjunto.');

    try {
      const eliminado = await repositorio.eliminar(id, operador.email);
      if (!eliminado) return noEncontrado(respuesta, 'No existe ese adjunto.');
      peticion.log.info({ evento: 'adjunto_eliminado' }, 'adjunto eliminado');
      return await respuesta.code(204).send();
    } catch (e: unknown) {
      if (e instanceof ErrorAdjunto) {
        return respuesta.code(e.estado).send({ error: 'adjunto_rechazado', mensaje: e.message });
      }
      responderErrorDb(peticion, respuesta, e);
      return respuesta;
    }
  });
}
