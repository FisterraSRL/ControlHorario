/**
 * The real session adapter.
 *
 * There is no token anywhere in this file. The server sets an `httpOnly` cookie, the browser
 * sends it, and this code never sees it — which is why an injected script cannot steal it
 * and why "log out" means "the row is gone from `sesiones`" rather than "we forgot it".
 */

import { conJson, esObjeto, ErrorApi, pedir, pedirJson } from '../http.js';
import { esRolUsuario, leerSectores, type RolUsuario } from '../roles.js';
import { ErrorSesion, type RepositorioSesion, type Sesion } from './RepositorioSesion.js';

interface CuerpoSesion {
  readonly usuario: {
    readonly email: string;
    readonly nombre: string;
    readonly rol: RolUsuario;
    readonly sectores?: unknown;
  };
  readonly expiraAt?: string;
}

/**
 * Whether the body is a session.
 *
 * READ THIS BEFORE NARROWING IT. `iniciar()` below turns a rejected body into "el correo o
 * la contraseña no son correctos", because a 401 body and a body this guard does not
 * recognise are indistinguishable from here. So a role this function has not been told
 * about does not degrade to a reduced UI: it locks a person with the right password out of
 * the app, with a message that sends them to reset a password that was never wrong.
 *
 * That is why the role check is `esRolUsuario` from `roles.ts` and not a literal comparison:
 * there is exactly one list to extend, and it is the same one the users adapter reads.
 *
 * `sectores` is deliberately NOT part of the check. It is read leniently afterwards, so a
 * server that does not send it — or sends it wrong — still logs the person in.
 */
export function esCuerpoSesion(valor: unknown): valor is CuerpoSesion {
  if (!esObjeto(valor)) return false;
  const usuario = valor['usuario'];
  return (
    esObjeto(usuario) &&
    typeof usuario['email'] === 'string' &&
    typeof usuario['nombre'] === 'string' &&
    esRolUsuario(usuario['rol'])
  );
}

export function aSesion(cuerpo: CuerpoSesion): Sesion {
  return {
    operador: {
      email: cuerpo.usuario.email,
      nombre: cuerpo.usuario.nombre,
      rol: cuerpo.usuario.rol,
      sectores: leerSectores(cuerpo.usuario.sectores),
    },
    expiraAt: cuerpo.expiraAt ?? null,
    autenticada: true,
  };
}

export function crearRepositorioSesionHttp(base: string): RepositorioSesion {
  const sesion = `${base}/sesion`;

  return {
    async actual() {
      // A 401 here is the answer to the question, not a failure: nobody is logged in.
      const respuesta = await pedir(sesion, { method: 'GET' }, { lanzarEn401: false });
      if (respuesta.status === 401) return null;
      const cuerpo = await respuesta.json().catch(() => null);
      return esCuerpoSesion(cuerpo) ? aSesion(cuerpo) : null;
    },

    async iniciar(email, contrasena) {
      let cuerpo: unknown;
      try {
        cuerpo = await pedirJson(
          sesion,
          conJson('POST', { email, contrasena }),
          { lanzarEn401: false },
        );
      } catch (e: unknown) {
        if (e instanceof ErrorApi) {
          throw new ErrorSesion(e.message, e.estado === 429);
        }
        throw e;
      }

      if (!esCuerpoSesion(cuerpo)) {
        // A 401 body has `error`/`mensaje` and no `usuario`, and so does anything else that
        // went wrong. One message for all of them: see RESPUESTA_CREDENCIALES in
        // src/api/autenticacion.ts for why the server refuses to be more specific.
        const mensaje =
          esObjeto(cuerpo) && typeof cuerpo['mensaje'] === 'string'
            ? cuerpo['mensaje']
            : 'El correo o la contraseña no son correctos.';
        throw new ErrorSesion(mensaje);
      }
      return aSesion(cuerpo);
    },

    async cambiarContrasena(actual, nueva) {
      await pedir(`${sesion}/contrasena`, conJson('PUT', { actual, nueva }));
    },

    async cerrar() {
      // A 401 is a fine outcome: the session was already gone, which is what was asked for.
      await pedir(sesion, { method: 'DELETE' }, { lanzarEn401: false });
    },
  };
}
