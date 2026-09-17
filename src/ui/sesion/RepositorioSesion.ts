/**
 * The session boundary.
 *
 * A port, like `RepositorioFichadas`: the screens know this interface and nothing about
 * cookies, endpoints or `argon2`. There are two adapters, and the difference between them
 * is not a detail:
 *
 *   `repositorioSesionHttp`   the real one. Talks to `/api/sesion`; the cookie is set by the
 *                             server and is `httpOnly`, so nothing in this folder can read
 *                             it — which is the point.
 *
 *   `repositorioSesionLocal`  the offline path. `npm run dev` with no `.env` has no server,
 *                             no database and therefore nothing to authenticate against.
 *                             It reports a fixed local operator and refuses to pretend
 *                             otherwise: the screens show a banner saying so.
 *
 * There is no "remember me", no token in `localStorage` and no way to read the session from
 * JavaScript. A token a script can read is a token an injected script can steal.
 */

export interface Operador {
  readonly email: string;
  readonly nombre: string;
  readonly rol: 'admin' | 'operador';
}

export interface Sesion {
  readonly operador: Operador;
  /** ISO timestamp. Shown nowhere today; kept so a later "your session ends at" can exist. */
  readonly expiraAt: string | null;
  /**
   * `false` for the localStorage adapter. The screens use it to explain that this browser is
   * on its own — attachments need the server, and nothing here is shared with anybody.
   */
  readonly autenticada: boolean;
}

/** Thrown when the credentials are refused, or the server refuses to answer. */
export class ErrorSesion extends Error {
  override readonly name = 'ErrorSesion';
  constructor(
    mensaje: string,
    /** `true` when the server rate-limited the attempt, so the screen can say to wait. */
    readonly demasiadosIntentos = false,
  ) {
    super(mensaje);
  }
}

export interface RepositorioSesion {
  /** The current session, or `null` when nobody is logged in. Never throws on a 401. */
  actual(): Promise<Sesion | null>;
  iniciar(email: string, contrasena: string): Promise<Sesion>;
  cerrar(): Promise<void>;
}
