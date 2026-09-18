import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { appConSesion, crearPoolFalso, sesionDePrueba, type Respondedor } from './pruebas/dobles.js';
import { registrarRutasUsuarios } from './rutasUsuarios.js';

const CREADO = {
  id: '7',
  email: 'jefa@ejemplo.test',
  nombre: 'Jefa De Cocina',
  rol: 'encargado',
  activo: true,
  creado_at: new Date('2026-01-05T09:00:00.000Z'),
};

const ADMIN = sesionDePrueba({ rol: 'admin', email: 'admin@ejemplo.test' });

let app: FastifyInstance | null = null;

async function levantar(responder: Respondedor = () => undefined): Promise<{
  readonly app: FastifyInstance;
  readonly pool: ReturnType<typeof crearPoolFalso>;
}> {
  const pool = crearPoolFalso((texto, valores) => {
    if (texto.includes('INSERT INTO [controlhorario].[usuarios]')) return { rows: [CREADO] };
    return responder(texto, valores);
  });
  app = await appConSesion(ADMIN, (instancia) => {
    registrarRutasUsuarios(instancia, pool);
  });
  return { app, pool };
}

function crear(servidor: FastifyInstance, cuerpo: Record<string, unknown>) {
  return servidor.inject({ method: 'POST', url: '/api/admin/usuarios', payload: cuerpo });
}

afterEach(async () => {
  await app?.close();
  app = null;
});

describe('POST /api/admin/usuarios con sectores', () => {
  it('crea el encargado y sus sectores en la misma transacción', async () => {
    const { app: servidor, pool } = await levantar();

    const respuesta = await crear(servidor, {
      email: 'Jefa@Ejemplo.test',
      nombre: 'Jefa De Cocina',
      rol: 'encargado',
      sectores: ['Cocina', 'Reparto'],
    });

    expect(respuesta.statusCode).toBe(201);
    const usuario = pool.llamadas.find((l) =>
      l.texto.includes('INSERT INTO [controlhorario].[usuarios]'),
    );
    const asignados = pool.llamadas.find((l) =>
      l.texto.includes('INSERT INTO [controlhorario].[usuarios_sectores]'),
    );
    // Both statements, one transaction, committed: an encargado without sectors is an
    // account that can log in and see nothing, and half of this write would create one.
    expect(usuario?.enTransaccion).toBe(true);
    expect(asignados?.enTransaccion).toBe(true);
    expect(asignados?.texto).toContain('OPENJSON($2)');
    expect(asignados?.valores).toEqual(['7', '["Cocina","Reparto"]']);
    expect(pool.cierres).toEqual(['commit']);
    expect(respuesta.json().usuario.sectores).toEqual(['Cocina', 'Reparto']);
  });

  it('si fallan los sectores no queda el usuario suelto', async () => {
    const { app: servidor, pool } = await levantar((texto) =>
      texto.includes('usuarios_sectores') ? new Error('falló el INSERT de sectores') : undefined,
    );

    const respuesta = await crear(servidor, {
      email: 'jefa@ejemplo.test',
      nombre: 'Jefa De Cocina',
      rol: 'encargado',
      sectores: ['Cocina'],
    });

    expect(respuesta.statusCode).toBe(500);
    expect(pool.cierres).toEqual(['rollback']);
  });

  it('normaliza los sectores antes de escribirlos', async () => {
    const { app: servidor, pool } = await levantar();

    await crear(servidor, {
      email: 'jefa@ejemplo.test',
      nombre: 'Jefa De Cocina',
      rol: 'encargado',
      sectores: ['  Cocina  ', 'Cocina', 'Reparto'],
    });

    const asignados = pool.llamadas.find((l) => l.texto.includes('usuarios_sectores'));
    expect(asignados?.valores[1]).toBe('["Cocina","Reparto"]');
  });

  it('rechaza un encargado sin sectores y no escribe nada', async () => {
    const { app: servidor, pool } = await levantar();

    const respuesta = await crear(servidor, {
      email: 'jefa@ejemplo.test',
      nombre: 'Jefa De Cocina',
      rol: 'encargado',
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json()).toMatchObject({ error: 'sectores_requeridos' });
    expect(pool.llamadas).toEqual([]);
  });

  it('rechaza un encargado cuyos sectores son todos espacios en blanco', async () => {
    const { app: servidor, pool } = await levantar();

    const respuesta = await crear(servidor, {
      email: 'jefa@ejemplo.test',
      nombre: 'Jefa De Cocina',
      rol: 'encargado',
      sectores: ['   '],
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json()).toMatchObject({ error: 'sectores_requeridos' });
    expect(pool.llamadas).toEqual([]);
  });

  it('rechaza sectores en una cuenta que no es encargado', async () => {
    const { app: servidor, pool } = await levantar();

    const respuesta = await crear(servidor, {
      email: 'rrhh@ejemplo.test',
      nombre: 'Operadora Nueva',
      rol: 'operador',
      sectores: ['Cocina'],
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json()).toMatchObject({ error: 'sectores_no_corresponden' });
    expect(pool.llamadas).toEqual([]);
  });

  it('un operador nuevo sin sectores no toca la tabla de cruce', async () => {
    const { app: servidor, pool } = await levantar();

    const respuesta = await crear(servidor, {
      email: 'rrhh@ejemplo.test',
      nombre: 'Operadora Nueva',
      rol: 'operador',
    });

    expect(respuesta.statusCode).toBe(201);
    expect(pool.textos().some((t) => t.includes('usuarios_sectores'))).toBe(false);
  });

  it('el rol encargado es un valor aceptado por el esquema del cuerpo', async () => {
    const { app: servidor } = await levantar();

    const respuesta = await crear(servidor, {
      email: 'jefa@ejemplo.test',
      nombre: 'Jefa De Cocina',
      rol: 'jefa-suprema',
      sectores: ['Cocina'],
    });

    expect(respuesta.statusCode).toBe(400);
  });
});

describe('GET /api/admin/usuarios', () => {
  it('devuelve los sectores de cada cuenta', async () => {
    const { app: servidor } = await levantar((texto) => {
      if (texto.includes('FROM [controlhorario].[usuarios] ORDER BY')) {
        return { rows: [CREADO, { ...CREADO, id: '8', rol: 'operador' }] };
      }
      if (texto.includes('usuarios_sectores')) {
        return {
          rows: [
            { usuario_id: '7', sector: 'Cocina' },
            { usuario_id: '7', sector: 'Reparto' },
          ],
        };
      }
      return undefined;
    });

    const respuesta = await servidor.inject({ method: 'GET', url: '/api/admin/usuarios' });

    expect(respuesta.statusCode).toBe(200);
    const { usuarios } = respuesta.json();
    expect(usuarios[0].sectores).toEqual(['Cocina', 'Reparto']);
    expect(usuarios[1].sectores).toEqual([]);
  });
});

describe('el panel de usuarios sigue siendo sólo para administradores', () => {
  it('un encargado recibe 403 sin llegar a la base', async () => {
    const pool = crearPoolFalso();
    app = await appConSesion(sesionDePrueba({ rol: 'encargado', sectores: ['Cocina'] }), (i) => {
      registrarRutasUsuarios(i, pool);
    });

    const respuesta = await app.inject({ method: 'GET', url: '/api/admin/usuarios' });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json()).toMatchObject({ error: 'solo_administradores' });
    expect(pool.llamadas).toEqual([]);
  });

  it('un operador tampoco entra', async () => {
    const pool = crearPoolFalso();
    app = await appConSesion(sesionDePrueba({ rol: 'operador' }), (i) => {
      registrarRutasUsuarios(i, pool);
    });

    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/admin/usuarios',
      payload: { email: 'x@ejemplo.test', nombre: 'X', rol: 'operador' },
    });

    expect(respuesta.statusCode).toBe(403);
    expect(pool.llamadas).toEqual([]);
  });
});
