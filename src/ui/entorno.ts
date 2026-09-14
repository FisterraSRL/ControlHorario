/**
 * The one place that decides whether this build talks to a server.
 *
 * `VITE_API_BASE_URL` is substituted by Vite AT BUILD TIME — it cannot be read at runtime —
 * so the container image is built with `/api` (see the `args` of the `api` service in
 * docker-compose.yml) and a plain `npm run dev` with no `.env` gets nothing and runs on
 * localStorage.
 *
 * WHY THIS IS A MODULE AND NOT A LINE IN EACH FACTORY. There are now four ports — historial,
 * ausencias, configuración, adjuntos — plus the session. If each read the variable itself,
 * a future refactor could leave one of them pointing at the server while the others were on
 * localStorage, and the screens would show a registry that belongs to a historial that is
 * not there. One decision, read once, used by all of them.
 */

export interface ModoServidor {
  /** The API root, e.g. `/api`. Never empty. */
  readonly base: string;
}

export function modoServidor(
  baseConfigurada: string | undefined = import.meta.env['VITE_API_BASE_URL'] as
    | string
    | undefined,
): ModoServidor | null {
  const base = (baseConfigurada ?? '').trim().replace(/\/+$/, '');
  return base === '' ? null : { base };
}

/**
 * `true` when the app runs with no server at all: no Postgres, no login, no attachments.
 *
 * This is the offline path and it is not a leftover — it is what makes `npm run dev` and a
 * demo on a laptop work with nothing running. The README calls it out; keeping it alive is
 * the reason every port below has two adapters.
 */
export function esModoLocal(): boolean {
  return modoServidor() === null;
}
