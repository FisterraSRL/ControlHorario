/**
 * THE FRONTEND IS ON ANOTHER ORIGIN NOW, AND THIS IS THE FILE THAT PROVES IT WORKS.
 *
 * The SPA is a static bundle on Vercel; the API is on Azure. Two origins, one session
 * cookie, and three separate things that each silently break the login if they are wrong:
 *
 *   1. the cookie needs `SameSite=None; Secure`, or the browser accepts the login response
 *      and stores nothing;
 *   2. the API needs `Access-Control-Allow-Credentials: true` with ONE exact origin, or the
 *      browser refuses to let the app read any answer;
 *   3. the `OPTIONS` preflight has to be answered WITHOUT a session, or a logged-in operator
 *      gets a CORS error on every write.
 *
 * None of the three produces a server-side error, an exception or a log line. Each one
 * produces "I log in and it sends me back to the login screen", which is the same symptom
 * for all three plus for a dozen unrelated causes. That is the whole reason this file is
 * worth its length.
 *
 * WHAT IT CANNOT DO: `app.inject` is not a browser. It never refuses a `SameSite=None`
 * cookie without `Secure`, never blocks a response for a missing `Allow-Origin`, and never
 * sends a preflight on its own. What is asserted here is the exact bytes of the headers the
 * server emits — which is the half that lives in this repository. The other half, that a
 * real browser then does the right thing with them, needs the deployed pair.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ErrorConfiguracion, leerConfiguracion } from './config.js';
import { crearUsuarioDePrueba, iniciarSesion } from './pruebas/ayudas.js';
import { levantarBase, reiniciarDatos, type BaseDePrueba } from './pruebas/basePrueba.js';

/** The shape the Vercel deployment boots in. No real hostname: this is an example.org URL. */
const ORIGEN = 'https://controlhorario.ejemplo.test';
const OTRO_ORIGEN = 'https://no-somos-nosotros.ejemplo.test';

let base: BaseDePrueba;

beforeAll(async () => {
  base = await levantarBase({
    entorno: {
      APP_ORIGEN_FRONTEND: ORIGEN,
      // Production value. `app.inject` speaks plain HTTP and does not care, which is what
      // lets the real production attributes be asserted here at all.
      API_COOKIE_SEGURA: 'true',
    },
  });
  await crearUsuarioDePrueba(base.pool);
}, 60_000);

afterAll(async () => {
  await base.cerrar();
});

describe('la cookie de sesión cruzando orígenes', () => {
  it('sale con SameSite=None y Secure, que es lo único que el navegador guarda', async () => {
    const respuesta = await base.app.inject({
      method: 'POST',
      url: '/api/sesion',
      headers: { origin: ORIGEN },
      payload: { email: 'rrhh@ejemplo.test', contrasena: 'una-contrasena-larga-de-prueba' },
    });
    expect(respuesta.statusCode).toBe(200);

    const cabecera = respuesta.headers['set-cookie'];
    const texto = Array.isArray(cabecera) ? cabecera.join('\n') : String(cabecera);
    expect(texto).toMatch(/SameSite=None/i);
    expect(texto).toMatch(/Secure/);
    expect(texto).toMatch(/HttpOnly/i);
    // `Lax` here would be the bug: the browser would not attach the cookie to a call from
    // the Vercel origin at all, and every request after the login would be a 401.
    expect(texto).not.toMatch(/SameSite=Lax/i);
  });

  it('borra la sesión con los mismos atributos con los que la puso', async () => {
    // A browser only removes a cookie when the clearing Set-Cookie matches the attributes it
    // was stored with. A `clearCookie` that dropped `SameSite=None` would leave a dead
    // cookie in the browser forever: every request 401s and re-logging in does not help,
    // because the new cookie never replaces the old one.
    const cookie = await iniciarSesion(base);
    const respuesta = await base.app.inject({
      method: 'DELETE',
      url: '/api/sesion',
      headers: { cookie, origin: ORIGEN },
    });
    expect(respuesta.statusCode).toBe(204);

    const cabecera = respuesta.headers['set-cookie'];
    const texto = Array.isArray(cabecera) ? cabecera.join('\n') : String(cabecera);
    expect(texto).toMatch(/SameSite=None/i);
    expect(texto).toMatch(/Secure/);
  });

  afterEach(async () => {
    await reiniciarDatos(base);
    await crearUsuarioDePrueba(base.pool);
  });
});

describe('CORS', () => {
  it('contesta el preflight sin pedir sesión', async () => {
    // The request that breaks everything if it is guarded: a browser sends it with no
    // cookies, so behind the session hook it would be a 401 and the real call would never
    // leave the page.
    const respuesta = await base.app.inject({
      method: 'OPTIONS',
      url: '/api/ausencias/motivo',
      headers: {
        origin: ORIGEN,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(respuesta.statusCode).toBe(204);
    expect(respuesta.headers['access-control-allow-origin']).toBe(ORIGEN);
    expect(respuesta.headers['access-control-allow-credentials']).toBe('true');
    expect(String(respuesta.headers['access-control-allow-methods'])).toContain('PUT');
    expect(String(respuesta.headers['access-control-allow-headers'])).toContain('content-type');
  });

  it('nunca contesta con un comodín', async () => {
    // `*` is not merely lax here, it is inoperative: a browser rejects the combination of a
    // wildcard origin and `Allow-Credentials: true`, so the app would break anyway. This
    // asserts the exact origin, which is what makes the failure impossible rather than
    // merely unlikely.
    const respuesta = await base.app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: ORIGEN },
    });
    expect(respuesta.headers['access-control-allow-origin']).toBe(ORIGEN);
    expect(respuesta.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('marca Vary: Origin para que ninguna caché mezcle respuestas de dos orígenes', async () => {
    const respuesta = await base.app.inject({ method: 'GET', url: '/health' });
    expect(String(respuesta.headers['vary'])).toContain('Origin');
  });

  it('no autoriza a otro origen, ni siquiera con una sesión válida', async () => {
    const cookie = await iniciarSesion(base);
    const respuesta = await base.app.inject({
      method: 'GET',
      url: '/api/ausencias',
      headers: { cookie, origin: OTRO_ORIGEN },
    });
    // The request is processed — the cookie is valid and this is not a browser — but no
    // allow header comes back, which is exactly what makes a browser refuse to hand the body
    // to the page that asked for it.
    expect(respuesta.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rechaza el preflight de otro origen con 403 y no con 401', async () => {
    const respuesta = await base.app.inject({
      method: 'OPTIONS',
      url: '/api/ausencias/motivo',
      headers: { origin: OTRO_ORIGEN, 'access-control-request-method': 'PUT' },
    });
    // 403 and not 401: "log in" is not the remedy and saying so sends whoever is debugging
    // this to the wrong file.
    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.headers['access-control-allow-origin']).toBeUndefined();
  });
});

/**
 * The boot-time validations, exercised through the real `leerConfiguracion`.
 *
 * Each of these is a mistake that produces no error at runtime and a login that does not
 * stick. Refusing to start, with the variable named, is the only feedback that arrives
 * before the operator's afternoon does.
 */
describe('validación de configuración al arrancar', () => {
  function conEntorno<T>(extra: Record<string, string | undefined>, fn: () => T): T {
    const previo = new Map<string, string | undefined>();
    for (const [k, v] of Object.entries(extra)) {
      previo.set(k, process.env[k]);
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return fn();
    } finally {
      for (const [k, v] of previo) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  const BASE_DATOS = {
    DB_SERVER: 'servidor.database.windows.net',
    DB_USER: 'x',
    DB_PASSWORD: 'x',
    DB_NAME: 'x',
  };

  it('se niega a arrancar con SameSite=None y sin Secure', () => {
    expect(() =>
      conEntorno(
        {
          ...BASE_DATOS,
          APP_ORIGEN_FRONTEND: ORIGEN,
          API_COOKIE_SAMESITE: 'none',
          API_COOKIE_SEGURA: 'false',
        },
        () => leerConfiguracion(),
      ),
    ).toThrow(ErrorConfiguracion);
  });

  it('elige SameSite=none solo cuando hay un frontend en otro origen', () => {
    const cruzado = conEntorno(
      { ...BASE_DATOS, APP_ORIGEN_FRONTEND: ORIGEN, API_COOKIE_SAMESITE: undefined },
      () => leerConfiguracion(),
    );
    expect(cruzado.sesion.sameSite).toBe('none');

    // The local stack, where this same process serves the SPA: `lax` is both enough and
    // stricter, and nothing about this change should have quietly loosened it.
    const mismoOrigen = conEntorno(
      { ...BASE_DATOS, APP_ORIGEN_FRONTEND: undefined, API_COOKIE_SAMESITE: undefined },
      () => leerConfiguracion(),
    );
    expect(mismoOrigen.sesion.sameSite).toBe('lax');
    expect(mismoOrigen.origenFrontend).toBe('');
  });

  it('acepta que un despliegue en el mismo dominio vuelva a lax', () => {
    // `app.fisterra.com.ar` calling `api.fisterra.com.ar` is cross-ORIGIN but same-SITE, so
    // a Lax cookie travels and is the stricter choice. The derived default would pick
    // `none`; this is the override that exists for it.
    const config = conEntorno(
      { ...BASE_DATOS, APP_ORIGEN_FRONTEND: ORIGEN, API_COOKIE_SAMESITE: 'lax' },
      () => leerConfiguracion(),
    );
    expect(config.sesion.sameSite).toBe('lax');
  });

  it('rechaza un origen con ruta, que nunca coincidiría con el encabezado Origin', () => {
    expect(() =>
      conEntorno({ ...BASE_DATOS, APP_ORIGEN_FRONTEND: `${ORIGEN}/app` }, () =>
        leerConfiguracion(),
      ),
    ).toThrow(/solo el origen/);
  });

  it('rechaza un origen que no sea https', () => {
    expect(() =>
      conEntorno({ ...BASE_DATOS, APP_ORIGEN_FRONTEND: 'http://ejemplo.test' }, () =>
        leerConfiguracion(),
      ),
    ).toThrow(ErrorConfiguracion);
  });

  it('deja el pool en un tamaño conservador por defecto', () => {
    // The database is shared with two other projects. This number is a promise to them, so
    // it is pinned rather than left to whatever felt right when `crearPool` was written.
    const config = conEntorno({ ...BASE_DATOS, DB_MAX_CONEXIONES: undefined }, () =>
      leerConfiguracion(),
    );
    expect(config.baseDeDatos.maxConexiones).toBe(5);
  });

  it('usa el puerto de Azure SQL por defecto', () => {
    const config = conEntorno({ ...BASE_DATOS, DB_PORT: undefined }, () => leerConfiguracion());
    expect(config.baseDeDatos.puerto).toBe(1433);
  });
});
