/**
 * Attachments: the metadata in Postgres, the bytes on the local disk.
 *
 * THESE FILES ARE MEDICAL CERTIFICATES. Everything below follows from that one sentence.
 *
 * 1. THEY ARE NOT STATIC FILES. There is no path under `/adjuntos/...` that a web server
 *    hands out, because a static path is a URL that works for anybody who has it — and a
 *    URL to somebody's medical certificate ends up in a chat, in a browser history, in a
 *    referrer header. Every read goes through a route that checks the session first.
 *
 * 2. THE STORED NAME IS GENERATED, NEVER THE OPERATOR'S. `blob_path` is a UUID plus an
 *    extension derived from the VALIDATED content type. The name the file had on the
 *    operator's computer is data: it goes in `adjuntos.nombre`, it is shown on screen, and
 *    it never touches a filesystem path. A path built from a user-supplied string is one
 *    `..\..\` away from writing into the application directory, and one NUL byte away from
 *    truncating into something else entirely — on Windows it is also one `CON` or `PRN`
 *    away from a device name.
 *
 * 3. THE PATH READ BACK OUT OF THE DATABASE IS RE-VALIDATED. `blob_path` is written by this
 *    file and only by this file, so it is already safe — and it is checked anyway before
 *    being joined, because "the database only ever contains what we put there" is an
 *    assumption that survives exactly until the first restored backup or the first psql
 *    session.
 *
 * 4. TYPE AND SIZE ARE VALIDATED ON THE WAY IN, against an allow-list. See
 *    `TIPOS_ADJUNTO_PERMITIDOS` in config.ts.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

import { auditar, idDeDia } from './auditoria.js';
import { TIPOS_ADJUNTO_PERMITIDOS } from './config.js';
import { enTransaccion, type Pool } from './db.js';

/** Exactly what this file writes: a v4 UUID, a dot, and a short lowercase extension. */
const NOMBRE_ALMACENADO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,8}$/;

export class ErrorAdjunto extends Error {
  override readonly name = 'ErrorAdjunto';
  constructor(
    mensaje: string,
    /** What the route should answer. 415 wrong type, 413 too big, 400 malformed. */
    readonly estado: number,
  ) {
    super(mensaje);
  }
}

export interface Adjunto {
  readonly id: number;
  readonly dni: string;
  /** `YYYY-MM-DD`. */
  readonly fecha: string;
  /** The name the file had when it was uploaded. Display only; never a path. */
  readonly nombre: string;
  readonly bytes: number;
  readonly tipoMime: string | null;
  readonly subidoPor: string | null;
  readonly subidoAt: string;
}

interface FilaAdjunto {
  id: number;
  dni: string;
  fecha: string;
  nombre: string;
  bytes: number;
  tipo_mime: string | null;
  subido_por: string | null;
  subido_at: Date | string;
  blob_path?: string;
}

function aAdjunto(f: FilaAdjunto): Adjunto {
  return {
    id: f.id,
    dni: f.dni,
    fecha: f.fecha,
    nombre: f.nombre,
    bytes: Number(f.bytes),
    tipoMime: f.tipo_mime,
    subidoPor: f.subido_por,
    subidoAt: f.subido_at instanceof Date ? f.subido_at.toISOString() : String(f.subido_at),
  };
}

const CAMPOS = `
  id, dni, to_char(fecha, 'YYYY-MM-DD') AS fecha, nombre, bytes, tipo_mime, subido_por, subido_at
`;

/**
 * The extension a file of this content type is stored under.
 *
 * Derived from the type and not from the filename, so the extension on disk is one of six
 * known strings and cannot be `.php`, `.lnk`, or a second dot away from something else.
 */
export function extensionDe(tipoMime: string): string {
  const ext = TIPOS_ADJUNTO_PERMITIDOS[tipoMime.toLowerCase().split(';')[0]?.trim() ?? ''];
  if (!ext) {
    throw new ErrorAdjunto(
      'Ese tipo de archivo no se puede adjuntar. Se aceptan PDF y fotos (JPG, PNG, WEBP, HEIC).',
      415,
    );
  }
  return ext;
}

/**
 * Turns a stored name into an absolute path, or refuses.
 *
 * `resolve` after the shape check is belt and braces: even a name that somehow satisfied
 * the regexp could not escape, but the containment assertion means a future change to the
 * regexp cannot turn into a traversal without this throwing first.
 */
export function rutaDeArchivo(directorio: string, blobPath: string): string {
  if (!NOMBRE_ALMACENADO.test(blobPath)) {
    throw new ErrorAdjunto('El archivo guardado tiene un nombre que este servidor no escribió.', 400);
  }
  const base = resolve(directorio);
  const completa = resolve(join(base, blobPath));
  if (completa !== join(base, blobPath) || !completa.startsWith(base + sep)) {
    throw new ErrorAdjunto('Ruta de adjunto fuera del directorio de adjuntos.', 400);
  }
  return completa;
}

export interface DatosSubida {
  readonly dni: string;
  /** `YYYY-MM-DD`. */
  readonly fecha: string;
  /** The operator's own filename. Stored as data, never used to build a path. */
  readonly nombre: string;
  readonly tipoMime: string;
  readonly flujo: Readable;
  /**
   * Whether the multipart parser cut the stream short at its own `fileSize` limit.
   *
   * Busboy does not throw when a file exceeds the limit: it stops emitting data and sets a
   * flag. So the counter below never sees the overflow — it sees a file that stops exactly
   * at the maximum — and without this callback an 80 MB upload would be stored as a
   * perfectly valid-looking 10 MB truncated file, which for a PDF certificate means an
   * unreadable one filed as if it were fine.
   */
  readonly truncado?: () => boolean;
}

export interface ArchivoAbierto {
  readonly adjunto: Adjunto;
  readonly ruta: string;
  /**
   * The size ON DISK, which is what `Content-Length` has to say.
   *
   * `adjuntos.bytes` is what was written when the row was created, and the two agree in
   * every ordinary case. They can differ after a partial volume restore — and a
   * `Content-Length` larger than the body is a response the client waits on until it times
   * out, which looks like the server hanging rather than like a missing file.
   */
  readonly bytes: number;
}

export interface RepositorioAdjuntosPostgres {
  /**
   * Every attachment on record, newest last.
   *
   * The whole list rather than one day's, because the Ausencias table shows a count on
   * every row and asking per row would be one request per absence. It is also the reason
   * there is no `?dni=` filter anywhere in this API: a DNI in a URL is personal data in a
   * log line, in a proxy's access log and in a browser's history. Filtering happens in the
   * screen, over data the operator is already authorised to see in full.
   */
  listar(): Promise<readonly Adjunto[]>;
  guardar(datos: DatosSubida, maxBytes: number, actor: string): Promise<Adjunto>;
  abrir(id: number): Promise<ArchivoAbierto | null>;
  eliminar(id: number, actor: string): Promise<boolean>;
}

export function crearRepositorioAdjuntos(
  pool: Pool,
  directorio: string,
): RepositorioAdjuntosPostgres {
  return {
    async listar() {
      const { rows } = await pool.query<FilaAdjunto>(
        `SELECT ${CAMPOS} FROM adjuntos ORDER BY dni, fecha, subido_at, id`,
      );
      return rows.map(aAdjunto);
    },

    /**
     * Writes the bytes first, then the row, and deletes the bytes if the row fails.
     *
     * The other order would leave a row pointing at a file that does not exist, which the
     * download route can only report as a 500 for a certificate somebody believes they
     * filed. This order can leave an orphaned file on disk after a database failure, which
     * costs a few megabytes and nothing else. The `unlink` below makes even that unlikely.
     */
    async guardar(datos, maxBytes, actor) {
      const extension = extensionDe(datos.tipoMime);
      const blobPath = `${randomUUID()}.${extension}`;
      await mkdir(directorio, { recursive: true });
      const destino = rutaDeArchivo(directorio, blobPath);

      let escritos = 0;
      /**
       * The size cap is enforced here as well as by the multipart parser's own `fileSize`
       * limit. The parser's limit truncates the stream and sets a flag the caller has to
       * remember to read; this one cannot be forgotten, and it is the reason a 200 MB
       * upload never becomes a 200 MB file on the office machine's disk.
       */
      const contador = new TransformStreamContador(maxBytes, (n) => {
        escritos = n;
      });

      try {
        await pipeline(datos.flujo, contador.stream(), createWriteStream(destino, { flags: 'wx' }));
      } catch (e: unknown) {
        await unlink(destino).catch(() => undefined);
        if (e instanceof ErrorAdjunto) throw e;
        throw new ErrorAdjunto('No se pudo guardar el archivo en el servidor.', 500);
      }

      if (datos.truncado?.()) {
        await unlink(destino).catch(() => undefined);
        throw new ErrorAdjunto(
          `El archivo supera el máximo permitido (${Math.floor(maxBytes / (1024 * 1024))} MB).`,
          413,
        );
      }

      if (escritos === 0) {
        await unlink(destino).catch(() => undefined);
        throw new ErrorAdjunto('El archivo está vacío.', 400);
      }

      try {
        return await enTransaccion(pool, async (cliente) => {
          const { rows } = await cliente.query<FilaAdjunto>(
            `INSERT INTO adjuntos (dni, fecha, blob_path, nombre, bytes, tipo_mime, subido_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING ${CAMPOS}`,
            [
              datos.dni,
              datos.fecha,
              blobPath,
              datos.nombre,
              escritos,
              datos.tipoMime,
              actor,
            ],
          );
          const fila = rows[0];
          if (!fila) throw new Error('El INSERT en adjuntos no devolvió la fila.');
          await auditar(cliente, {
            actor,
            accion: 'adjunto_subido',
            entidad: 'adjuntos',
            entidadId: idDeDia(datos.dni, datos.fecha),
            // The filename is not in here. "MEDINA - certificado psiquiátrico.pdf" is a
            // diagnosis in a filename, and `auditoria` is read by more people than
            // `adjuntos` is. The id and the size are enough to tie the row to the file.
            datos: { adjuntoId: fila.id, bytes: escritos, tipoMime: datos.tipoMime },
          });
          return aAdjunto(fila);
        });
      } catch (e: unknown) {
        await unlink(destino).catch(() => undefined);
        throw e;
      }
    },

    async abrir(id) {
      const { rows } = await pool.query<FilaAdjunto>(
        `SELECT ${CAMPOS}, blob_path FROM adjuntos WHERE id = $1`,
        [id],
      );
      const fila = rows[0];
      if (!fila?.blob_path) return null;
      const ruta = rutaDeArchivo(directorio, fila.blob_path);
      let bytes: number;
      try {
        bytes = (await stat(ruta)).size;
      } catch {
        // The row is there and the file is not: a half-restored backup, or somebody
        // cleaning a volume. Reported as "not found" rather than as a 500, because that is
        // what it is from the caller's side, and the row is left alone for an operator to
        // look at rather than deleted on a guess.
        return null;
      }
      return { adjunto: aAdjunto(fila), ruta, bytes };
    },

    async eliminar(id, actor) {
      const objetivo = await pool.query<FilaAdjunto>(
        `SELECT ${CAMPOS}, blob_path FROM adjuntos WHERE id = $1`,
        [id],
      );
      const fila = objetivo.rows[0];
      if (!fila?.blob_path) return false;

      await enTransaccion(pool, async (cliente) => {
        await cliente.query('DELETE FROM adjuntos WHERE id = $1', [id]);
        await auditar(cliente, {
          actor,
          accion: 'adjunto_eliminado',
          entidad: 'adjuntos',
          entidadId: idDeDia(fila.dni, fila.fecha),
          datos: { adjuntoId: id },
        });
      });

      // After the commit, and failure-tolerant: the row is gone, which is what the operator
      // asked for, and an unlinkable file is a stray byte range rather than a broken state.
      await unlink(rutaDeArchivo(directorio, fila.blob_path)).catch(() => undefined);
      return true;
    },
  };
}

/**
 * A pass-through that counts bytes and aborts past the limit.
 *
 * A class rather than a closure only so the byte count survives the pipeline: `pipeline`
 * resolves after the last stream finishes, and the count has to be readable then.
 */
class TransformStreamContador {
  private total = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly alTerminar: (n: number) => void,
  ) {}

  stream(): NodeJS.ReadWriteStream {
    const self = this;
    return new Transform({
      transform(trozo: Buffer, _codificacion, siguiente) {
        self.total += trozo.length;
        if (self.total > self.maxBytes) {
          siguiente(
            new ErrorAdjunto(
              `El archivo supera el máximo permitido (${Math.floor(self.maxBytes / (1024 * 1024))} MB).`,
              413,
            ),
          );
          return;
        }
        self.alTerminar(self.total);
        siguiente(null, trozo);
      },
    });
  }
}
