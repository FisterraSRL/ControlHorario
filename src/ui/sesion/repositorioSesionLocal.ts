/**
 * The offline session adapter: there is nobody to authenticate.
 *
 * `npm run dev` with no `.env` runs the whole app on this browser's own localStorage — no
 * server, no Postgres, no network. Asking for a password there would be theatre: there is
 * no account to check it against, the data is already in this browser's storage, and
 * anybody who can open devtools can read all of it.
 *
 * So this adapter says "yes, you are in", flags the session as NOT authenticated, and the
 * shell renders a banner that says what that means. Pretending otherwise would teach an
 * operator that the padlock in the corner means something it does not.
 */

import type { RepositorioSesion, Sesion } from './RepositorioSesion.js';

const SESION_LOCAL: Sesion = {
  operador: { email: 'local', nombre: 'Uso local sin servidor', rol: 'operador' },
  expiraAt: null,
  autenticada: false,
};

export function crearRepositorioSesionLocal(): RepositorioSesion {
  return {
    async actual() {
      return SESION_LOCAL;
    },
    async iniciar() {
      return SESION_LOCAL;
    },
    async cambiarContrasena() {
      throw new Error('En el modo local no hay una cuenta ni una contraseña que cambiar.');
    },
    async cerrar() {
      // Nothing to invalidate. Returning quietly rather than throwing keeps the header's
      // "Salir" button from having to know which adapter is underneath it.
    },
  };
}
