/**
 * Authentication, against the real Fastify app and a real Postgres (PGlite).
 *
 * The test that matters most is `deniega una ruta nueva que nadie protegió`: it registers a
 * route this file invents, on the running server, and expects a 401. That is the difference
 * between "every route we remembered to protect is protected" and "the default is denied".
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { levantarBase, reiniciarDatos, type BaseDePrueba } from './pruebas/basePrueba.js';
import { CONTRASENA_PRUEBA, crearUsuarioDePrueba, iniciarSesion } from './pruebas/ayudas.js';

/**
 * One database and one server for the whole file, emptied between tests.
 *
 * A fresh PGlite per test costs about a second of WebAssembly boot each; `reiniciarDatos`
 * truncates instead and restores the rows the migration seeded, which is the state a real
 * server starts from anyway.
 */
let base: BaseDePrueba;

beforeAll(async () => {
  base = await levantarBase({
    // Registered after the session guard, with no authentication of its own — exactly the
    // mistake the hook exists to survive. See the fail-closed test below.
    rutasExtra: (app) => {
      app.get('/api/ruta-nueva-sin-pensar', async () => ({ secreto: 'todo el padrón' }));
    },
    // And one registered BEFORE the guard exists, which is the case a reader assumes is
    // safe because "the hook runs first". It is safe, and this is what says so.
    rutasAntes: (app) => {
      app.get('/api/ruta-anterior-al-guardia', async () => ({ secreto: 'todo el padrón' }));
    },
  });
});

afterAll(async () => {
  await base.cerrar();
});

beforeEach(async () => {
  await reiniciarDatos(base);
  await crearUsuarioDePrueba(base.pool);
});

describe('la migración', () => {
  it('applies 001 and 002 and records both in the ledger', async () => {
    const { rows } = await base.pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(rows.map((r) => r.version)).toEqual([
      '001_initial.sql',
      '002_acceso_y_decisiones.sql',
    ]);
  });

  it('refuses to store a password that is not an argon2id PHC string', async () => {
    await expect(
      base.pool.query(
        `INSERT INTO usuarios (email, nombre, hash_contrasena)
         VALUES ('otro@ejemplo.test', 'Otro', 'e3b0c44298fc1c149afbf4c8996fb924')`,
      ),
    ).rejects.toThrow();
  });

  it('refuses an email that is not lower-cased', async () => {
    await expect(
      base.pool.query(
        `INSERT INTO usuarios (email, nombre, hash_contrasena)
         VALUES ('Ana@Ejemplo.Test', 'Ana', '$argon2id$v=19$m=1,t=1,p=1$x$y')`,
      ),
    ).rejects.toThrow();
  });
});

describe('sin sesión', () => {
  it('answers 401 on every /api route', async () => {
    const rutas: readonly [string, string][] = [
      ['GET', '/api/fichadas'],
      ['POST', '/api/fichadas'],
      ['DELETE', '/api/fichadas'],
      ['GET', '/api/ausencias'],
      ['PUT', '/api/ausencias/motivo'],
      ['GET', '/api/configuracion'],
      ['PATCH', '/api/configuracion/parametros'],
      ['GET', '/api/adjuntos'],
      ['POST', '/api/adjuntos'],
      ['GET', '/api/adjuntos/1/archivo'],
      ['DELETE', '/api/adjuntos/1'],
      ['GET', '/api/sesion'],
      ['DELETE', '/api/sesion'],
    ];
    for (const [method, url] of rutas) {
      const respuesta = await base.app.inject({ method: method as 'GET', url });
      expect(`${method} ${url} -> ${respuesta.statusCode}`).toBe(`${method} ${url} -> 401`);
    }
  });

  it('denies a route nobody remembered to protect', async () => {
    const respuesta = await base.app.inject({ method: 'GET', url: '/api/ruta-nueva-sin-pensar' });
    expect(respuesta.statusCode).toBe(401);
    expect(respuesta.body).not.toContain('padrón');
  });

  it('denies a route registered before the guard existed', async () => {
    const respuesta = await base.app.inject({
      method: 'GET',
      url: '/api/ruta-anterior-al-guardia',
    });
    expect(respuesta.statusCode).toBe(401);
    expect(respuesta.body).not.toContain('padrón');
  });

  it('leaves /health open, because the person on call is not logged in', async () => {
    const respuesta = await base.app.inject({ method: 'GET', url: '/health' });
    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toMatchObject({ ok: true, servicio: 'controlhorario-api' });
  });

  it('does not put a session cookie on a request that has none', async () => {
    const respuesta = await base.app.inject({ method: 'GET', url: '/api/fichadas' });
    expect(respuesta.cookies).toEqual([]);
  });
});

describe('login', () => {
  it('sets an httpOnly session cookie and returns the operator', async () => {
    const respuesta = await base.app.inject({
      method: 'POST',
      url: '/api/sesion',
      payload: { email: 'rrhh@ejemplo.test', contrasena: CONTRASENA_PRUEBA },
    });
    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toMatchObject({
      usuario: { email: 'rrhh@ejemplo.test', nombre: 'Operadora De Prueba' },
    });

    const cookie = respuesta.cookies.find((c) => c.name === base.config.sesion.cookie);
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
    expect(cookie?.path).toBe('/');
  });

  it('accepts the email in any case', async () => {
    const respuesta = await base.app.inject({
      method: 'POST',
      url: '/api/sesion',
      payload: { email: '  RRHH@Ejemplo.TEST ', contrasena: CONTRASENA_PRUEBA },
    });
    expect(respuesta.statusCode).toBe(200);
  });

  it('stores a hash of the cookie and never the cookie itself', async () => {
    const cookie = await iniciarSesion(base);
    const valor = cookie.split('=')[1] ?? '';
    const { rows } = await base.pool.query<{ id: string }>('SELECT id FROM sesiones');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(valor);
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('answers the same for a wrong password and for an email that does not exist', async () => {
    const inexistente = await base.app.inject({
      method: 'POST',
      url: '/api/sesion',
      payload: { email: 'nadie@ejemplo.test', contrasena: CONTRASENA_PRUEBA },
    });
    const malaClave = await base.app.inject({
      method: 'POST',
      url: '/api/sesion',
      payload: { email: 'rrhh@ejemplo.test', contrasena: 'no-es-la-contrasena' },
    });

    expect(inexistente.statusCode).toBe(401);
    expect(malaClave.statusCode).toBe(401);
    expect(inexistente.body).toBe(malaClave.body);
  });

  it('does not log the failed attempt against an identifiable actor', async () => {
    await base.app.inject({
      method: 'POST',
      url: '/api/sesion',
      payload: { email: 'nadie@ejemplo.test', contrasena: 'xxxxxxxxxxxx' },
    });
    const { rows } = await base.pool.query<{ actor: string; entidad_id: string | null }>(
      "SELECT actor, entidad_id FROM auditoria WHERE accion = 'login_fallido'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe('anonimo');
    expect(rows[0]?.entidad_id).toBeNull();
  });

  it('refuses a deactivated operator', async () => {
    await base.pool.query("UPDATE usuarios SET activo = FALSE WHERE email = 'rrhh@ejemplo.test'");
    const respuesta = await base.app.inject({
      method: 'POST',
      url: '/api/sesion',
      payload: { email: 'rrhh@ejemplo.test', contrasena: CONTRASENA_PRUEBA },
    });
    expect(respuesta.statusCode).toBe(401);
  });

  it('records the login in auditoria, attributed to the operator', async () => {
    await iniciarSesion(base);
    const { rows } = await base.pool.query<{ actor: string }>(
      "SELECT actor FROM auditoria WHERE accion = 'login'",
    );
    expect(rows.map((r) => r.actor)).toEqual(['rrhh@ejemplo.test']);
  });
});

describe('límite de intentos', () => {
  it('answers 429 once the per-account window is spent, and says how long to wait', async () => {
    const conLimite = await levantarBase({
      limitesLogin: { porCuenta: 3, global: 100, ventanaMs: 60_000 },
    });
    try {
      await crearUsuarioDePrueba(conLimite.pool);
      const fallar = () =>
        conLimite.app.inject({
          method: 'POST',
          url: '/api/sesion',
          payload: { email: 'rrhh@ejemplo.test', contrasena: 'no-es-la-contrasena' },
        });

      expect((await fallar()).statusCode).toBe(401);
      expect((await fallar()).statusCode).toBe(401);
      expect((await fallar()).statusCode).toBe(401);

      const cuarta = await fallar();
      expect(cuarta.statusCode).toBe(429);
      expect(Number(cuarta.headers['retry-after'])).toBeGreaterThan(0);

      // Even the correct password is refused while the window is spent: the limiter counts
      // attempts, not failures, so a guessing run cannot reset it by succeeding elsewhere.
      const conLaBuena = await conLimite.app.inject({
        method: 'POST',
        url: '/api/sesion',
        payload: { email: 'rrhh@ejemplo.test', contrasena: CONTRASENA_PRUEBA },
      });
      expect(conLaBuena.statusCode).toBe(429);
    } finally {
      await conLimite.cerrar();
    }
  });

  it('does not let one account being hammered lock out another', async () => {
    const conLimite = await levantarBase({
      limitesLogin: { porCuenta: 2, global: 100, ventanaMs: 60_000 },
    });
    try {
      await crearUsuarioDePrueba(conLimite.pool, 'una@ejemplo.test');
      await crearUsuarioDePrueba(conLimite.pool, 'otra@ejemplo.test');
      for (let i = 0; i < 5; i++) {
        await conLimite.app.inject({
          method: 'POST',
          url: '/api/sesion',
          payload: { email: 'una@ejemplo.test', contrasena: 'mal' },
        });
      }
      const otra = await conLimite.app.inject({
        method: 'POST',
        url: '/api/sesion',
        payload: { email: 'otra@ejemplo.test', contrasena: CONTRASENA_PRUEBA },
      });
      expect(otra.statusCode).toBe(200);
    } finally {
      await conLimite.cerrar();
    }
  });
});

describe('logout', () => {
  it('deletes the session server-side, so the same cookie stops working', async () => {
    const cookie = await iniciarSesion(base);

    expect((await base.app.inject({ method: 'GET', url: '/api/sesion', headers: { cookie } })).statusCode).toBe(200);

    const salida = await base.app.inject({
      method: 'DELETE',
      url: '/api/sesion',
      headers: { cookie },
    });
    expect(salida.statusCode).toBe(204);

    const { rows } = await base.pool.query<{ n: number }>(
      'SELECT count(*)::bigint AS n FROM sesiones',
    );
    expect(Number(rows[0]?.n)).toBe(0);

    const despues = await base.app.inject({
      method: 'GET',
      url: '/api/sesion',
      headers: { cookie },
    });
    expect(despues.statusCode).toBe(401);
  });

  it('is recorded in auditoria', async () => {
    const cookie = await iniciarSesion(base);
    await base.app.inject({ method: 'DELETE', url: '/api/sesion', headers: { cookie } });
    const { rows } = await base.pool.query<{ actor: string }>(
      "SELECT actor FROM auditoria WHERE accion = 'logout'",
    );
    expect(rows.map((r) => r.actor)).toEqual(['rrhh@ejemplo.test']);
  });
});

describe('sesión vencida', () => {
  it('is refused and the dead cookie is cleared', async () => {
    const cookie = await iniciarSesion(base);
    // `sesiones_expira_despues` forbids moving the expiry behind the creation, so the row
    // is aged rather than truncated — which is also what actually happens over time.
    await base.pool.query(
      `UPDATE sesiones
          SET creada_at = now() - interval '2 days',
              expira_at = now() - interval '1 minute'`,
    );

    const respuesta = await base.app.inject({
      method: 'GET',
      url: '/api/fichadas',
      headers: { cookie },
    });
    expect(respuesta.statusCode).toBe(401);
    expect(respuesta.json()).toMatchObject({ error: 'sesion_vencida' });
    const limpiada = respuesta.cookies.find((c) => c.name === base.config.sesion.cookie);
    expect(limpiada?.value).toBe('');
  });

  it('is refused when the operator is deactivated mid-session', async () => {
    const cookie = await iniciarSesion(base);
    await base.pool.query('UPDATE usuarios SET activo = FALSE');
    const respuesta = await base.app.inject({
      method: 'GET',
      url: '/api/fichadas',
      headers: { cookie },
    });
    expect(respuesta.statusCode).toBe(401);
  });
});
