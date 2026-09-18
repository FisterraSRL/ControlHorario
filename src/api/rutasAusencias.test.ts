import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { appConSesion, crearPoolFalso, sesionDePrueba } from './pruebas/dobles.js';
import type { AusenciaRegistrada, RepositorioAusenciasAzureSql } from './repositorioAusencias.js';
import { registrarRutasAusencias } from './rutasAusencias.js';
import type { Sesion } from './sesiones.js';

const DIA = { dni: '11000001', fecha: '05/01/2026', motivoId: 4 };

const AUSENCIA: AusenciaRegistrada = {
  dni: '11000001',
  fecha: '2026-01-05',
  motivoId: 4,
  motivoSource: 'encargado',
  resueltoPor: 'jefa@ejemplo.test',
  resueltoAt: '2026-01-06T10:00:00.000Z',
  adjuntos: 0,
};

/** Records what the routes asked the repository for, and answers as the real one would. */
function repositorioEspia(): RepositorioAusenciasAzureSql & {
  readonly asignaciones: unknown[][];
  readonly listados: unknown[];
} {
  const asignaciones: unknown[][] = [];
  const listados: unknown[] = [];
  return {
    asignaciones,
    listados,
    listar: (alcance) => {
      listados.push(alcance);
      return Promise.resolve([]);
    },
    asignarMotivo: (dni, fechaIso, motivoId, actor, origen) => {
      asignaciones.push([dni, fechaIso, motivoId, actor, origen]);
      return Promise.resolve(AUSENCIA);
    },
    sincronizar: () =>
      Promise.resolve({ vigentes: 0, creadas: 0, refrescadas: 0, podadas: 0 }),
  };
}

let app: FastifyInstance | null = null;

async function levantar(
  sesion: Sesion,
  sectorDelDia: string | null,
): Promise<{
  readonly app: FastifyInstance;
  readonly repositorio: ReturnType<typeof repositorioEspia>;
}> {
  const repositorio = repositorioEspia();
  const pool = crearPoolFalso(() => ({
    rows: sectorDelDia === null ? [] : [{ sector: sectorDelDia }],
  }));
  app = await appConSesion(sesion, (instancia) => {
    registrarRutasAusencias(instancia, { repositorio, pool });
  });
  return { app, repositorio };
}

afterEach(async () => {
  await app?.close();
  app = null;
});

describe('PUT /api/ausencias/motivo', () => {
  it('un encargado justifica un día de su sector', async () => {
    const sesion = sesionDePrueba({
      rol: 'encargado',
      email: 'jefa@ejemplo.test',
      sectores: ['Cocina'],
    });
    const { app: servidor, repositorio } = await levantar(sesion, 'Cocina');

    const respuesta = await servidor.inject({
      method: 'PUT',
      url: '/api/ausencias/motivo',
      payload: DIA,
    });

    expect(respuesta.statusCode).toBe(200);
    expect(repositorio.asignaciones).toEqual([
      ['11000001', '2026-01-05', 4, 'jefa@ejemplo.test', 'encargado'],
    ]);
  });

  it('rechaza con 403 un día de otro sector, sin escribir nada', async () => {
    const sesion = sesionDePrueba({ rol: 'encargado', sectores: ['Cocina'] });
    const { app: servidor, repositorio } = await levantar(sesion, 'Reparto');

    const respuesta = await servidor.inject({
      method: 'PUT',
      url: '/api/ausencias/motivo',
      payload: DIA,
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json()).toMatchObject({ error: 'fuera_de_alcance' });
    // The point of the test: the refusal happened BEFORE the write, not instead of showing it.
    expect(repositorio.asignaciones).toEqual([]);
  });

  it('un día sin fichada también es un rechazo', async () => {
    const sesion = sesionDePrueba({ rol: 'encargado', sectores: ['Cocina'] });
    const { app: servidor, repositorio } = await levantar(sesion, null);

    const respuesta = await servidor.inject({
      method: 'PUT',
      url: '/api/ausencias/motivo',
      payload: DIA,
    });

    expect(respuesta.statusCode).toBe(403);
    expect(repositorio.asignaciones).toEqual([]);
  });

  it('un encargado sin sectores no puede justificar nada', async () => {
    const sesion = sesionDePrueba({ rol: 'encargado', sectores: [] });
    const { app: servidor, repositorio } = await levantar(sesion, 'Cocina');

    const respuesta = await servidor.inject({
      method: 'PUT',
      url: '/api/ausencias/motivo',
      payload: DIA,
    });

    expect(respuesta.statusCode).toBe(403);
    expect(repositorio.asignaciones).toEqual([]);
  });

  it('RRHH escribe cualquier día y sigue siendo una decisión manual', async () => {
    const sesion = sesionDePrueba({ rol: 'operador', email: 'rrhh@ejemplo.test' });
    const { app: servidor, repositorio } = await levantar(sesion, 'Reparto');

    const respuesta = await servidor.inject({
      method: 'PUT',
      url: '/api/ausencias/motivo',
      payload: DIA,
    });

    expect(respuesta.statusCode).toBe(200);
    expect(repositorio.asignaciones[0]?.[4]).toBe('manual');
  });
});

describe('GET /api/ausencias', () => {
  it('le pasa al repositorio el alcance de quien pregunta', async () => {
    const sesion = sesionDePrueba({ rol: 'encargado', sectores: ['Cocina'] });
    const { app: servidor, repositorio } = await levantar(sesion, 'Cocina');

    await servidor.inject({ method: 'GET', url: '/api/ausencias' });

    expect(repositorio.listados).toEqual([['Cocina']]);
  });

  it('RRHH lee sin restricción', async () => {
    const sesion = sesionDePrueba({ rol: 'admin' });
    const { app: servidor, repositorio } = await levantar(sesion, 'Cocina');

    await servidor.inject({ method: 'GET', url: '/api/ausencias' });

    expect(repositorio.listados).toEqual([null]);
  });
});
