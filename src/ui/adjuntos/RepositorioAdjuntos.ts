/**
 * The attachments boundary.
 *
 * THESE FILES ARE MEDICAL CERTIFICATES, and that decides the shape of this port:
 *
 *   * there is no `url(adjunto)` method. A URL that renders the file is a URL that works
 *     for whoever has it, and one that ends up in a chat or a browser history is a leaked
 *     certificate. `descargar` fetches the bytes through an authenticated request and hands
 *     back a Blob the screen saves;
 *
 *   * `disponible` is part of the port, not an implementation detail. Attachments need the
 *     server: there is nowhere safe to put a medical certificate in this browser's
 *     localStorage, and the legacy file said the same thing in the same place ("Los
 *     adjuntos necesitan el guardado compartido"). The offline adapter reports `false` and
 *     the screen explains why instead of failing on click.
 */

export interface Adjunto {
  readonly id: number;
  readonly dni: string;
  /** `YYYY-MM-DD`. */
  readonly fecha: string;
  /** The name the file was uploaded with. Display only; it is never part of a path. */
  readonly nombre: string;
  readonly bytes: number;
  readonly tipoMime: string | null;
  readonly subidoPor: string | null;
  readonly subidoAt: string;
}

export interface RepositorioAdjuntos {
  /** `false` when this build has no server, and therefore nowhere to put a file. */
  readonly disponible: boolean;
  /** Every attachment on record. The screen groups them by `${dni}|${fecha}`. */
  listar(): Promise<readonly Adjunto[]>;
  /** `fechaStr` is the raw `DD/MM/YYYY` cell, which is what the screen has in hand. */
  subir(dni: string, fechaStr: string, archivo: File): Promise<Adjunto>;
  descargar(id: number): Promise<Blob>;
  eliminar(id: number): Promise<void>;
}
