/**
 * Which adapters this build runs against — all of them, decided once.
 *
 * This replaces `historial/crearRepositorio.ts`, which made the same decision for one port
 * back when there was only one. There are five now, and they have to agree: a build where
 * the historial is in Postgres and the absence registry is in localStorage would show a
 * registry that belongs to a historial nobody can see, and the operator would have no way
 * to tell.
 *
 * localStorage is not dead code and is not a leftover. It is the offline path: no server,
 * no database, no network, which is what makes `npm run dev` and a demo on a laptop work
 * with nothing running. The difference the operator can see is stated on screen — there is
 * no login and there are no attachments — rather than left to be discovered.
 */

import { crearRepositorioAdjuntosHttp } from './adjuntos/repositorioAdjuntosHttp.js';
import { crearRepositorioAdjuntosLocal } from './adjuntos/repositorioAdjuntosLocal.js';
import type { RepositorioAdjuntos } from './adjuntos/RepositorioAdjuntos.js';
import { crearRepositorioAusenciasHttp } from './ausencias/repositorioAusenciasHttp.js';
import { crearRepositorioAusenciasLocal } from './ausencias/repositorioAusenciasLocal.js';
import type { RepositorioAusencias } from './ausencias/RepositorioAusencias.js';
import { crearRepositorioConfiguracionHttp } from './configuracion/repositorioConfiguracionHttp.js';
import { crearRepositorioConfiguracionLocal } from './configuracion/repositorioConfiguracionLocal.js';
import type { RepositorioConfiguracion } from './configuracion/RepositorioConfiguracion.js';
import { modoServidor } from './entorno.js';
import { crearRepositorioHttp } from './historial/repositorioHttp.js';
import { crearRepositorioLocal } from './historial/repositorioLocal.js';
import type { RepositorioFichadas } from './historial/RepositorioFichadas.js';
import { crearRepositorioSesionHttp } from './sesion/repositorioSesionHttp.js';
import { crearRepositorioSesionLocal } from './sesion/repositorioSesionLocal.js';
import type { RepositorioSesion } from './sesion/RepositorioSesion.js';

export interface Repositorios {
  readonly conServidor: boolean;
  readonly sesion: RepositorioSesion;
  readonly fichadas: RepositorioFichadas;
  readonly ausencias: RepositorioAusencias;
  readonly configuracion: RepositorioConfiguracion;
  readonly adjuntos: RepositorioAdjuntos;
}

export function crearRepositorios(): Repositorios {
  const servidor = modoServidor();

  if (servidor) {
    // One line on boot, and it earns its place: "the upload said it saved but the data is
    // gone" and "the upload said it saved and it is in Postgres, on another machine" look
    // identical on screen and are different problems.
    console.info(`[controlhorario] servidor: ${servidor.base}`);
    return {
      conServidor: true,
      sesion: crearRepositorioSesionHttp(servidor.base),
      fichadas: crearRepositorioHttp(servidor.base),
      ausencias: crearRepositorioAusenciasHttp(servidor.base),
      configuracion: crearRepositorioConfiguracionHttp(servidor.base),
      adjuntos: crearRepositorioAdjuntosHttp(servidor.base),
    };
  }

  console.info(
    '[controlhorario] almacenamiento local de este navegador (sin servidor). Los datos no se ' +
      'comparten con nadie y se pierden si se borran los datos del sitio.',
  );
  const fichadas = crearRepositorioLocal();
  return {
    conServidor: false,
    sesion: crearRepositorioSesionLocal(),
    fichadas,
    // The offline registry is derived from the historial on every read, so it needs the
    // historial adapter rather than a store of its own. See its header.
    ausencias: crearRepositorioAusenciasLocal(fichadas),
    configuracion: crearRepositorioConfiguracionLocal(),
    adjuntos: crearRepositorioAdjuntosLocal(),
  };
}
