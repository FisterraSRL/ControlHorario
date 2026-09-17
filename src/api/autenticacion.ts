/**
 * Who is allowed to call the API.
 *
 * THE RULE, AND IT IS THE WHOLE POINT OF THIS FILE: every route under `/api/` requires a
 * valid session unless its exact method+path is on the list below. The check is an
 * `onRequest` hook on the whole instance, not a per-route decorator, because a per-route
 * decorator is a thing somebody forgets. A route added next month by somebody who never
 * read this file is denied, and the way to open it is to come here and add it to a list
 * whose name says what it means.
 *
 * FAIL CLOSED means the default answer to "is this route public?" is no. `RUTAS_PUBLICAS`
 * is an allow-list of exact strings — not a prefix, not a regex, not a `startsWith` — so
 * `/api/sesion/algo-nuevo` is protected even though `/api/sesion` is not.
 *
 * The hook runs at `onRequest`, which is BEFORE the body is parsed. An unauthenticated
 * upload is refused without the server ever reading 30 MB off the socket.
 *
 * WHAT IS DELIBERATELY NOT BEHIND IT:
 *
 *   `/health`             the thing you curl at 23:00. It reports up/down and a latency and
 *                         never a row; requiring a login to find out whether the server is
 *                         alive is how a monitoring check becomes a stored credential.
 *   `POST /api/sesion`    the login itself, which cannot require being logged in.
 *   the SPA               `/`, `/assets/*`, `/ausencias` and the rest of the deep links are
 *                         the login page. They are static files with no data in them; the
 *                         first thing the app does on boot is `GET /api/sesion`, which IS
 *                         behind the hook and answers 401.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
// Imported for its type augmentation as much as for the plugin: `request.cookies`,
// `reply.setCookie` and `reply.clearCookie` below only exist because @fastify/cookie
// declares them onto Fastify's own interfaces. `servidor.ts` is where it is registered.
import '@fastify/cookie';

import type { ConfiguracionApi } from './config.js';
import { auditar } from './auditoria.js';
import { hashearContrasena, hashDeSenuelo, verificarContrasena } from './contrasenas.js';
import { enTransaccion, type Pool } from './db.js';
import { crearLimitadorLogin, type LimitadorLogin } from './limitador.js';
import { ESQUEMA_CUERPO_CAMBIO_CONTRASENA, ESQUEMA_CUERPO_LOGIN } from './esquemas.js';
import { borrarSesion, buscarSesion, crearSesion, renovarSesion, type Sesion } from './sesiones.js';

/**
 * The only method+path pairs that answer without a session. Exact match, both parts.
 *
 * Adding to this list is a security decision. Anything with data in it does not belong here.
 */
const RUTAS_PUBLICAS: ReadonlySet<string> = new Set([
  'GET /health',
  'HEAD /health',
  'POST /api/sesion',
]);

/** Everything the hook guards. Outside this prefix lives the static SPA and nothing else. */
function esApi(ruta: string): boolean {
  return ruta === '/api' || ruta.startsWith('/api/');
}

function rutaSinConsulta(url: string): string {
  const corte = url.indexOf('?');
  return corte === -1 ? url : url.slice(0, corte);
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated operator. Present on every request the hook let through. */
    sesion?: Sesion;
  }
}

/**
 * The operator behind this request.
 *
 * Throws rather than returning null: a route that reaches this without a session is a route
 * that escaped the hook, and answering with `'desconocido'` in `auditoria.actor` would turn
 * a hole into a data-quality problem nobody notices.
 */
export function operadorDe(peticion: FastifyRequest): Sesion {
  const sesion = peticion.sesion;
  if (!sesion) {
    throw new Error(
      'Se llegó a un manejador autenticado sin sesión. Revisá RUTAS_PUBLICAS en autenticacion.ts.',
    );
  }
  return sesion;
}

interface CuerpoLogin {
  readonly email: string;
  readonly contrasena: string;
}

interface CuerpoCambioContrasena {
  readonly actual: string;
  readonly nueva: string;
}

export interface DependenciasAcceso {
  readonly config: ConfiguracionApi;
  readonly pool: Pool;
  /** Injected so a test can shrink the windows without waiting fifteen minutes. */
  readonly limitador?: LimitadorLogin;
}

/**
 * One body for every failed login, whatever the reason.
 *
 * The email does not exist, the account is deactivated, the password is wrong, the stored
 * hash is corrupt: all of them are this. Anything that distinguishes them — a different
 * message, a different status, a measurably different duration — is an oracle that tells an
 * outsider who works in RRHH at this company.
 */
const RESPUESTA_CREDENCIALES = {
  error: 'credenciales_invalidas',
  mensaje: 'El correo o la contraseña no son correctos.',
} as const;

function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function registrarAcceso(
  app: FastifyInstance,
  deps: DependenciasAcceso,
): Promise<void> {
  const { config, pool } = deps;
  const limitador = deps.limitador ?? crearLimitadorLogin();

  /**
   * Warms the decoy hash at boot.
   *
   * The first argon2 call in a process pays for the library's own lazy initialisation, so
   * without this the very first login — which is the one that hits the decoy path if the
   * email is unknown — would be measurably slower than every later one, and the timing
   * defence would have a hole exactly at the moment somebody is probing it.
   */
  void hashDeSenuelo();

  /**
   * THE COOKIE ATTRIBUTES, IN ONE OBJECT, USED BY ALL THREE OF SET, CLEAR AND RENEW.
   *
   * It has to be one object: a browser only removes a cookie when the `clearCookie`
   * attributes match the ones it was set with, so a `clearCookie` that forgot `SameSite` or
   * `Secure` leaves a dead session cookie in the browser forever, and the operator gets
   * "Tu sesión terminó" on every single request with no way out but clearing site data.
   *
   * `sameSite` comes from configuration and is `none` on the current deployment, because the
   * frontend is on Vercel and this API is on Azure — two different sites, and a `lax` cookie
   * is simply not sent between them. The full reasoning, and what `none` costs in CSRF
   * terms, is on `sesion.sameSite` in config.ts; the short version is that what replaces
   * `lax` here is the single-origin CORS allow-list plus the fact that every write is a JSON
   * request a browser cannot send cross-origin without a preflight we have to approve.
   *
   * `config.ts` refuses to boot with `sameSite: 'none'` and `secure: false`, which is the
   * combination browsers discard without telling anybody.
   */
  const opcionesCookie = {
    httpOnly: true,
    sameSite: config.sesion.sameSite,
    secure: config.sesion.segura,
    path: '/',
  } as const;

  /**
   * THE GUARD.
   *
   * A root-level `onRequest` hook covers every route on the instance — the ones registered
   * before it as well as the ones registered after, including ones that do not exist yet.
   * There is a test for each direction, because "the hook is added first so it is fine" is
   * an assumption about Fastify rather than a fact about this file.
   *
   * What it does depend on is staying at the ROOT. Wrapped in an encapsulated
   * `app.register(...)`, it would quietly stop covering anything outside that plugin's
   * scope, and every route outside it would answer 200 with a body full of DNIs.
   */
  app.addHook('onRequest', async (peticion, respuesta) => {
    const ruta = rutaSinConsulta(peticion.url);
    if (!esApi(ruta)) return;
    if (RUTAS_PUBLICAS.has(`${peticion.method} ${ruta}`)) return;

    const token = peticion.cookies[config.sesion.cookie];
    if (!token) {
      await respuesta.code(401).send({
        error: 'sin_sesion',
        mensaje: 'Iniciá sesión para usar el sistema.',
      });
      return;
    }

    let sesion: Sesion | null;
    try {
      sesion = await buscarSesion(pool, token);
    } catch (e: unknown) {
      // The database is down. A 401 here would tell the operator to log in again, they
      // would, it would fail the same way, and nobody would look at the database. 503 with
      // the same wording /health uses is the honest answer.
      peticion.log.error({ tipo: 'error_base_de_datos' }, 'no se pudo verificar la sesión');
      void e;
      await respuesta.code(503).send({
        error: 'base_de_datos',
        mensaje: 'No se pudo verificar la sesión porque la base de datos no responde.',
      });
      return;
    }

    if (!sesion) {
      // The cookie is dead: expired, logged out elsewhere, or the account was deactivated.
      // Clearing it stops the browser from sending it again on every request forever.
      void respuesta.clearCookie(config.sesion.cookie, opcionesCookie);
      await respuesta.code(401).send({
        error: 'sesion_vencida',
        mensaje: 'Tu sesión terminó. Volvé a iniciar sesión.',
      });
      return;
    }

    peticion.sesion = sesion;

    const nuevaExpiracion = await renovarSesion(pool, sesion, config.sesion.horas);
    if (nuevaExpiracion) {
      void respuesta.setCookie(config.sesion.cookie, token, {
        ...opcionesCookie,
        expires: nuevaExpiracion,
      });
    }
  });

  /**
   * Log in.
   *
   * The order below is the whole security of this endpoint:
   *   1. count the attempt (before anything else, so a rejected attempt still counts);
   *   2. look the account up;
   *   3. verify against the real hash, or against the decoy when there is no account;
   *   4. answer identically in every failure case.
   */
  app.post<{ Body: CuerpoLogin }>(
    '/api/sesion',
    { schema: { body: ESQUEMA_CUERPO_LOGIN } },
    async (peticion, respuesta) => {
      const email = normalizarEmail(peticion.body.email);
      const { contrasena } = peticion.body;

      const limite = limitador.intentar(email);
      if (!limite.permitido) {
        peticion.log.warn({ evento: 'login_limitado' }, 'demasiados intentos de acceso');
        return respuesta
          .code(429)
          .header('retry-after', String(limite.esperaS))
          .send({
            error: 'demasiados_intentos',
            mensaje:
              'Hubo demasiados intentos de acceso. Esperá unos minutos y volvé a probar.',
          });
      }

      const { rows } = await pool.query<{
        id: number;
        email: string;
        nombre: string;
        rol: 'admin' | 'operador';
        hash_contrasena: string;
      }>(
        `SELECT [id], [email], [nombre], [rol], [hash_contrasena]
           FROM [controlhorario].[usuarios]
          WHERE [email] = $1 AND [activo] = 1`,
        [email],
      );
      const usuario = rows[0];

      // Same work in both branches. See `hashDeSenuelo` in contrasenas.ts.
      const valida = await verificarContrasena(
        usuario?.hash_contrasena ?? (await hashDeSenuelo()),
        contrasena,
      );

      if (!usuario || !valida) {
        // No email, no id, nothing that identifies the attempt: this line exists to show a
        // rate, and a rate is all it shows.
        peticion.log.warn({ evento: 'login_fallido' }, 'intento de acceso rechazado');
        // Nor in the audit row. `auditoria` is read by more people than `usuarios` is, and
        // "someone tried to log in as ana@" is a sentence about Ana.
        await auditar(pool, {
          actor: 'anonimo',
          accion: 'login_fallido',
          entidad: 'usuarios',
          entidadId: null,
          datos: null,
        });
        return respuesta.code(401).send(RESPUESTA_CREDENCIALES);
      }

      limitador.exito(email);
      const { token, expiraAt } = await crearSesion(pool, usuario.id, config.sesion.horas);
      await auditar(pool, {
        actor: usuario.email,
        accion: 'login',
        entidad: 'usuarios',
        entidadId: String(usuario.id),
        datos: null,
      });
      peticion.log.info({ evento: 'login' }, 'sesión iniciada');

      void respuesta.setCookie(config.sesion.cookie, token, {
        ...opcionesCookie,
        expires: expiraAt,
      });
      return respuesta.send({
        usuario: { email: usuario.email, nombre: usuario.nombre, rol: usuario.rol },
        expiraAt: expiraAt.toISOString(),
      });
    },
  );

  /** Who am I. Behind the hook, so "nobody" is a 401 and the SPA needs no other check. */
  app.get('/api/sesion', async (peticion, respuesta) => {
    const sesion = operadorDe(peticion);
    return respuesta.send({
      usuario: { email: sesion.email, nombre: sesion.nombre, rol: sesion.rol },
      expiraAt: sesion.expiraAt.toISOString(),
    });
  });

  app.put<{ Body: CuerpoCambioContrasena }>(
    '/api/sesion/contrasena',
    { schema: { body: ESQUEMA_CUERPO_CAMBIO_CONTRASENA } },
    async (peticion, respuesta) => {
      const sesion = operadorDe(peticion);
      const { rows } = await pool.query<{ hash_contrasena: string }>(
        'SELECT [hash_contrasena] FROM [controlhorario].[usuarios] WHERE [id] = $1 AND [activo] = 1',
        [sesion.usuarioId],
      );
      const hashActual = rows[0]?.hash_contrasena;
      if (!hashActual || !(await verificarContrasena(hashActual, peticion.body.actual))) {
        return respuesta.code(400).send({
          error: 'contrasena_actual_incorrecta',
          mensaje: 'La contraseña actual no es correcta.',
        });
      }
      if (peticion.body.actual === peticion.body.nueva) {
        return respuesta.code(400).send({
          error: 'contrasena_repetida',
          mensaje: 'La contraseña nueva tiene que ser distinta de la actual.',
        });
      }
      const nuevoHash = await hashearContrasena(peticion.body.nueva);
      await enTransaccion(pool, async (c) => {
        await c.query(
          `UPDATE [controlhorario].[usuarios]
              SET [hash_contrasena] = $2, [actualizado_at] = SYSUTCDATETIME()
            WHERE [id] = $1`,
          [sesion.usuarioId, nuevoHash],
        );
        await c.query(
          'DELETE FROM [controlhorario].[sesiones] WHERE [usuario_id] = $1 AND [id] <> $2',
          [sesion.usuarioId, sesion.id],
        );
        await auditar(c, {
          actor: sesion.email,
          accion: 'contrasena_cambiada',
          entidad: 'usuarios',
          entidadId: String(sesion.usuarioId),
          datos: null,
        });
      });
      return respuesta.code(204).send();
    },
  );

  /**
   * Log out. Deletes the row, so the cookie is dead server-side and not merely forgotten by
   * one browser — which is the difference between logging out and closing the tab.
   */
  app.delete('/api/sesion', async (peticion, respuesta) => {
    const sesion = operadorDe(peticion);
    const token = peticion.cookies[config.sesion.cookie];
    if (token) await borrarSesion(pool, token);
    await auditar(pool, {
      actor: sesion.email,
      accion: 'logout',
      entidad: 'usuarios',
      entidadId: String(sesion.usuarioId),
      datos: null,
    });
    peticion.log.info({ evento: 'logout' }, 'sesión cerrada');
    void respuesta.clearCookie(config.sesion.cookie, opcionesCookie);
    return respuesta.code(204).send();
  });
}
