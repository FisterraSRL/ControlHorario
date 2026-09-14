/**
 * Which adapter the app runs against.
 *
 * One environment variable decides, and it decides at BUILD time — Vite substitutes
 * `import.meta.env.VITE_*` into the bundle when it compiles it and cannot read it later.
 * So the container image is built with `VITE_API_BASE_URL=/api` (see the `args` of the
 * `api` service in docker-compose.yml), and a plain `npm run dev` with no `.env` gets
 * localStorage.
 *
 * localStorage is not dead code and is not a leftover. It is the offline path: no server,
 * no database, no network, which is what makes `npm run dev` and a demo on a laptop work
 * with nothing running. Keeping both behind one interface is why slice 2c did not touch a
 * single screen.
 */

import { crearRepositorioHttp } from './repositorioHttp.js';
import { crearRepositorioLocal } from './repositorioLocal.js';
import type { RepositorioFichadas } from './RepositorioFichadas.js';

export type NombreAdaptador = 'http' | 'local';

export interface AdaptadorElegido {
  readonly nombre: NombreAdaptador;
  readonly repositorio: RepositorioFichadas;
  /** The configured base URL, for the console line below. Empty when running on localStorage. */
  readonly base: string;
}

export function elegirAdaptador(
  baseConfigurada: string | undefined = import.meta.env['VITE_API_BASE_URL'] as string | undefined,
): AdaptadorElegido {
  const base = (baseConfigurada ?? '').trim();
  if (base === '') {
    return { nombre: 'local', repositorio: crearRepositorioLocal(), base: '' };
  }
  return { nombre: 'http', repositorio: crearRepositorioHttp(base), base };
}

/**
 * Says which one it picked, once, on boot.
 *
 * This is the only console line the app writes, and it earns its place: "the upload said it
 * saved but the data is gone" and "the upload said it saved and it is in Postgres, on
 * another machine" look identical on screen and are different problems. The answer is the
 * first line of the console.
 */
export function crearRepositorio(): RepositorioFichadas {
  const elegido = elegirAdaptador();
  if (elegido.nombre === 'http') {
    console.info(`[historial] servidor: ${elegido.base}`);
  } else {
    console.info(
      '[historial] almacenamiento local de este navegador (sin servidor). ' +
        'Los datos no se comparten con nadie y se pierden si se borran los datos del sitio.',
    );
  }
  return elegido.repositorio;
}
