import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { appConSesion, crearPoolFalso, sesionDePrueba, type PoolFalso } from './pruebas/dobles.js';
import type { AusenciaRegistrada, RepositorioAusenciasAzureSql } from './repositorioAusencias.js';
import { diasPedidos, registrarRutasAusencias } from './rutasAusencias.js';
import type { DiaPedido } from './sectores.js';
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
  readonly lotes: unknown[][];
  readonly listados: unknown[];
} {
  const asignaciones: unknown[][] = [];
  const lotes: unknown[][] = [];
  const listados: unknown[] = [];
  return {
    asignaciones,
    lotes,
    listados,
    asignarMotivos: (dias, motivoId, actor, origen) => {
      lotes.push([dias, motivoId, actor, origen]);
      return Promise.resolve(
        dias.map((d) => ({ ...AUSENCIA, dni: d.dni, fecha: d.fechaIso, motivoId })),
      );
    },
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

/**
 * The batch route, over a pool that answers the ONE sector lookup the way the LEFT JOIN does:
 * a row per requested day, with that day's sector or NULL when there is no fichada.
 */
async function levantarLote(
  sesion: Sesion,
  sectores: Readonly<Record<string, string | null>>,
): Promise<{
  readonly app: FastifyInstance;
  readonly repositorio: ReturnType<typeof repositorioEspia>;
  readonly pool: PoolFalso;
}> {
  const repositorio = repositorioEspia();
  const pool = crearPoolFalso((texto, valores) => {
    if (!texto.includes('OPENJSON')) return undefined;
    const dias = JSON.parse(String(valores[0])) as DiaPedido[];
    return {
      rows: dias.map((d) => ({
        dni: d.dni,
        fecha: d.fechaIso,
        sector: sectores[`${d.dni}|${d.fechaIso}`] ?? null,
      })),
    };
  });
  app = await appConSesion(sesion, (instancia) => {
    registrarRutasAusencias(instancia, { repositorio, pool });
  });
  return { app, repositorio, pool };
}

const LOTE = {
  dias: [
    { dni: '11000001', fecha: '05/01/2026' },
    { dni: '11000002', fecha: '06/01/2026' },
    { dni: '11000003', fecha: '07/01/2026' },
  ],
  motivoId: 4,
};

const SECTORES_COCINA: Readonly<Record<string, string | null>> = {
  '11000001|2026-01-05': 'Cocina',
  '11000002|2026-01-06': 'Cocina',
  '11000003|2026-01-07': 'Cocina',
};

describe('PUT /api/ausencias/motivos', () => {
  it('un encargado clasifica varios días de su sector con una sola consulta de alcance', async () => {
    const sesion = sesionDePrueba({
      rol: 'encargado',
      email: 'jefa@ejemplo.test',
      sectores: ['Cocina'],
    });
    const { app: servidor, repositorio, pool } = await levantarLote(sesion, SECTORES_COCINA);

    const respuesta = await servidor.inject({
      method: 'PUT',
      url: '/api/ausencias/motivos',
      payload: LOTE,
    });

    expect(respuesta.statusCode).toBe(200);
    // One lookup for the whole batch, not one per day.
    expect(pool.llamadas).toHaveLength(1);
    expect(repositorio.lotes).toEqual([
      [
        [
          { dni: '11000001', fechaIso: '2026-01-05' },
          { dni: '11000002', fechaIso: '2026-01-06' },
          { dni: '11000003', fechaIso: '2026-01-07' },
        ],
        4,
        'jefa@ejemplo.test',
        'encargado',
      ],
    ]);
    // The rows as they now stand, so the screen can replace them without a reload.
    const cuerpo = respuesta.json<{ ausencias: AusenciaRegistrada[] }>();
    expect(cuerpo.ausencias.map((a) => a.fecha)).toEqual([
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
    ]);
  });

  it('un solo día de otro sector rechaza el lote entero, sin escribir nada', async () => {
    const sesion = sesionDePrueba({ rol: 'encargado', sectores: ['Cocina'] });
    const { app: servidor, repositorio } = await levantarLote(sesion, {
      ...SECTORES_COCINA,
      '11000002|2026-01-06': 'Reparto',
    });

    const respuesta = await servidor.inject({
      method: 'PUT',
      url: '/api/ausencias/motivos',
      payload: LOTE,
    });

    expect(respuesta.statusCode).toBe(403);
    expect(repositorio.lotes).toEqual([]);
    expect(repositorio.asignaciones).toEqual([]);
  });

  it('responde exactamente lo mismo que la ruta de un día, para no filtrar nada', async () => {
    const sesion = sesionDePrueba({ rol: 'encargado', sectores: ['Cocina'] });
    const { app: servidor } = await levantarLote(sesion, {});

    const lote = await servidor.inject({
      method: 'PUT',
      url: '/api/ausencias/motivos',
      payload: LOTE,
    });
    const uno = await servidor.inject({ method: 'PUT', url: '/api/ausencias/motivo', payload: DIA });

    expect(lote.statusCode).toBe(403);
    expect(uno.statusCode).toBe(403);
    expect(lote.json()).toEqual(uno.json());
  });

  it('un día sin fichada también rechaza el lote entero', async () => {
    const sesion = sesionDePrueba({ rol: 'encargado', sectores: ['Cocina'] });
    const { '11000003|2026-01-07': _sinFichada, ...sinUnaFichada } = SECTORES_COCINA;
    const { app: servidor, repositorio } = await levantarLote(sesion, sinUnaFichada);

    const respuesta = await servidor.inject({
      method: 'PUT',
      url: '/api/ausencias/motivos',
      payload: LOTE,
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json()).toMatchObject({ error: 'fuera_de_alcance' });
    expect(repositorio.lotes).toEqual([]);
  });

  it('RRHH no consulta el alcance y su decisión sigue siendo manual', async () => {
    const sesion = sesionDePrueba({ rol: 'operador', email: 'rrhh@ejemplo.test' });
    const { app: servidor, repositorio, pool } = await levantarLote(sesion, {});

    const respuesta = await servidor.inject({
      method: 'PUT',
      url: '/api/ausencias/motivos',
      payload: { ...LOTE, motivoId: null },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(pool.llamadas).toHaveLength(0);
    expect(repositorio.lotes[0]?.[1]).toBeNull();
    expect(repositorio.lotes[0]?.[3]).toBe('manual');
  });

  it('un día repetido se escribe una sola vez', async () => {
    const sesion = sesionDePrueba({ rol: 'admin' });
    const { app: servidor, repositorio } = await levantarLote(sesion, {});

    const respuesta = await servidor.inject({
      method: 'PUT',
      url: '/api/ausencias/motivos',
      payload: {
        dias: [
          { dni: '11000001', fecha: '05/01/2026' },
          { dni: '11000002', fecha: '05/01/2026' },
          { dni: '11000001', fecha: '05/01/2026' },
        ],
        motivoId: 4,
      },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(repositorio.lotes[0]?.[0]).toEqual([
      { dni: '11000001', fechaIso: '2026-01-05' },
      { dni: '11000002', fechaIso: '2026-01-05' },
    ]);
  });

  it('una fecha ilegible en cualquier día rechaza el lote con 400, antes de consultar nada', async () => {
    const sesion = sesionDePrueba({ rol: 'encargado', sectores: ['Cocina'] });
    const { app: servidor, repositorio, pool } = await levantarLote(sesion, SECTORES_COCINA);

    const respuesta = await servidor.inject({
      method: 'PUT',
      url: '/api/ausencias/motivos',
      payload: {
        dias: [...LOTE.dias, { dni: '11000004', fecha: '2026-01-08' }],
        motivoId: 4,
      },
    });

    expect(respuesta.statusCode).toBe(400);
    expect(pool.llamadas).toHaveLength(0);
    expect(repositorio.lotes).toEqual([]);
  });

  it('rechaza un lote vacío, uno de más de 500 días y un campo de más', async () => {
    const sesion = sesionDePrueba({ rol: 'admin' });
    const { app: servidor, repositorio } = await levantarLote(sesion, {});
    const pedir = (payload: object) =>
      servidor.inject({ method: 'PUT', url: '/api/ausencias/motivos', payload });

    const demasiados = Array.from({ length: 501 }, (_, i) => ({
      dni: String(11000000 + i),
      fecha: '05/01/2026',
    }));

    expect((await pedir({ dias: [], motivoId: 4 })).statusCode).toBe(400);
    expect((await pedir({ dias: demasiados, motivoId: 4 })).statusCode).toBe(400);
    expect((await pedir({ ...LOTE, sector: 'Cocina' })).statusCode).toBe(400);
    expect(
      (await pedir({ dias: [{ dni: '11000001', fecha: '05/01/2026', motivoId: 9 }], motivoId: 4 }))
        .statusCode,
    ).toBe(400);
    // `motivoId` is required: omitting it is not a silent "clear".
    expect((await pedir({ dias: LOTE.dias })).statusCode).toBe(400);
    expect(repositorio.lotes).toEqual([]);
  });
});

describe('días pedidos en un lote', () => {
  it('convierte a ISO y descarta repetidos conservando el orden', () => {
    expect(
      diasPedidos([
        { dni: 'B', fecha: '06/01/2026' },
        { dni: 'A', fecha: '05/01/2026' },
        { dni: 'B', fecha: '06/01/2026' },
      ]),
    ).toEqual([
      { dni: 'B', fechaIso: '2026-01-06' },
      { dni: 'A', fechaIso: '2026-01-05' },
    ]);
  });

  it('una sola fecha ilegible invalida todo el lote', () => {
    expect(
      diasPedidos([
        { dni: 'A', fecha: '05/01/2026' },
        { dni: 'B', fecha: '6/1/2026' },
      ]),
    ).toBeNull();
  });
});
