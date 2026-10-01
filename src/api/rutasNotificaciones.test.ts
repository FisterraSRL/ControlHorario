import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { appConSesion, crearPoolFalso, sesionDePrueba } from './pruebas/dobles.js';
import {
  crearRepositorioNotificaciones,
  type FaltaPedida,
  type RepositorioNotificacionesAzureSql,
} from './repositorioNotificaciones.js';
import { faltasPedidas, fechaIsoReal, registrarRutasNotificaciones } from './rutasNotificaciones.js';
import type { Sesion } from './sesiones.js';

const RRHH = sesionDePrueba({ rol: 'operador', email: 'rrhh@ejemplo.test' });
const ENCARGADO = sesionDePrueba({ rol: 'encargado', sectores: ['Cocina'] });

const CUERPO = {
  faltas: [
    { dni: '11000001', fecha: '2026-09-15', tipo: 'tardanza' },
    { dni: '11000001', fecha: '2026-09-15', tipo: 'incompleta' },
  ],
};

/** Records what the routes asked for and answers as the real repository would. */
function repositorioEspia(): RepositorioNotificacionesAzureSql & {
  readonly registros: [readonly FaltaPedida[], string][];
  readonly listados: [string, string][];
} {
  const registros: [readonly FaltaPedida[], string][] = [];
  const listados: [string, string][] = [];
  return {
    registros,
    listados,
    registrar: (faltas, actor) => {
      registros.push([faltas, actor]);
      return Promise.resolve(faltas.length);
    },
    listar: (desde, hasta) => {
      listados.push([desde, hasta]);
      return Promise.resolve([
        { dni: '11000001', fecha: '2026-09-15', tipo: 'tardanza', notificadoAt: '2026-09-20T13:00:00.000Z' },
      ]);
    },
  };
}

let app: FastifyInstance | null = null;

async function levantar(
  sesion: Sesion,
  repositorio: RepositorioNotificacionesAzureSql = repositorioEspia(),
): Promise<FastifyInstance> {
  app = await appConSesion(sesion, (instancia) => {
    registrarRutasNotificaciones(instancia, { repositorio });
  });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = null;
});

describe('POST /api/notificaciones', () => {
  it('RRHH registra las faltas que cubre el Word, a su nombre', async () => {
    const repositorio = repositorioEspia();
    const servidor = await levantar(RRHH, repositorio);

    const respuesta = await servidor.inject({ method: 'POST', url: '/api/notificaciones', payload: CUERPO });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({ registradas: 2 });
    expect(repositorio.registros).toEqual([
      [
        [
          { dni: '11000001', fechaIso: '2026-09-15', tipo: 'tardanza' },
          { dni: '11000001', fechaIso: '2026-09-15', tipo: 'incompleta' },
        ],
        'rrhh@ejemplo.test',
      ],
    ]);
  });

  it('un encargado recibe 403 y no se escribe nada', async () => {
    const repositorio = repositorioEspia();
    const servidor = await levantar(ENCARGADO, repositorio);

    const respuesta = await servidor.inject({ method: 'POST', url: '/api/notificaciones', payload: CUERPO });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json<{ error: string }>().error).toBe('solo_rrhh');
    expect(repositorio.registros).toEqual([]);
  });

  it('una falta repetida se registra una sola vez', async () => {
    const repositorio = repositorioEspia();
    const servidor = await levantar(RRHH, repositorio);

    const respuesta = await servidor.inject({
      method: 'POST',
      url: '/api/notificaciones',
      payload: { faltas: [...CUERPO.faltas, CUERPO.faltas[0]] },
    });

    expect(respuesta.json()).toEqual({ registradas: 2 });
    expect(repositorio.registros[0]?.[0]).toHaveLength(2);
  });

  it.each([
    ['sin faltas', { faltas: [] }],
    ['un campo de más', { faltas: CUERPO.faltas, extra: 1 }],
    ['una clase de falta desconocida', { faltas: [{ dni: '1', fecha: '2026-09-15', tipo: 'ausencia' }] }],
    ['la fecha de la celda QUICKPASS', { faltas: [{ dni: '1', fecha: '15/09/2026', tipo: 'tardanza' }] }],
    ['un día que no existe', { faltas: [{ dni: '1', fecha: '2026-02-30', tipo: 'tardanza' }] }],
    [
      'más de 5000 faltas',
      { faltas: Array.from({ length: 5001 }, (_, i) => ({ dni: String(i), fecha: '2026-09-15', tipo: 'tardanza' })) },
    ],
  ])('rechaza con 400 %s, sin escribir nada', async (_caso, payload) => {
    const repositorio = repositorioEspia();
    const servidor = await levantar(RRHH, repositorio);

    const respuesta = await servidor.inject({ method: 'POST', url: '/api/notificaciones', payload });

    expect(respuesta.statusCode).toBe(400);
    expect(repositorio.registros).toEqual([]);
  });

  it('un día sin fichada viola la clave foránea y vuelve como 409', async () => {
    const pool = crearPoolFalso((texto) =>
      texto.includes('MERGE') ? Object.assign(new Error('FK'), { number: 547 }) : undefined,
    );
    const servidor = await levantar(RRHH, crearRepositorioNotificaciones(pool));

    const respuesta = await servidor.inject({ method: 'POST', url: '/api/notificaciones', payload: CUERPO });

    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json<{ error: string }>().error).toBe('integridad');
    expect(pool.cierres).toEqual(['rollback']);
  });
});

describe('GET /api/notificaciones', () => {
  it('RRHH lee las notificaciones de la ventana', async () => {
    const repositorio = repositorioEspia();
    const servidor = await levantar(RRHH, repositorio);

    const respuesta = await servidor.inject({
      method: 'GET',
      url: '/api/notificaciones?desde=2026-09-01&hasta=2026-09-30',
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual({
      notificadas: [{ dni: '11000001', fecha: '2026-09-15', tipo: 'tardanza', notificadoAt: '2026-09-20T13:00:00.000Z' }],
    });
    expect(repositorio.listados).toEqual([['2026-09-01', '2026-09-30']]);
  });

  it('acepta un año bisiesto entero y un solo día', async () => {
    const servidor = await levantar(RRHH);
    for (const url of [
      '/api/notificaciones?desde=2028-01-01&hasta=2028-12-31',
      '/api/notificaciones?desde=2026-09-15&hasta=2026-09-15',
    ]) {
      expect((await servidor.inject({ method: 'GET', url })).statusCode).toBe(200);
    }
  });

  it('un encargado recibe 403', async () => {
    const repositorio = repositorioEspia();
    const servidor = await levantar(ENCARGADO, repositorio);

    const respuesta = await servidor.inject({
      method: 'GET',
      url: '/api/notificaciones?desde=2026-09-01&hasta=2026-09-30',
    });

    expect(respuesta.statusCode).toBe(403);
    expect(repositorio.listados).toEqual([]);
  });

  it.each([
    ['sin hasta', '?desde=2026-09-01'],
    ['sin ventana', ''],
    ['una fecha con otro formato', '?desde=01/09/2026&hasta=2026-09-30'],
    ['un día que no existe', '?desde=2026-02-30&hasta=2026-03-01'],
    ['la ventana invertida', '?desde=2026-09-30&hasta=2026-09-01'],
    ['más de 400 días', '?desde=2025-01-01&hasta=2026-02-05'],
    ['un parámetro de más', '?desde=2026-09-01&hasta=2026-09-30&dni=1'],
  ])('rechaza con 400 %s, sin consultar', async (_caso, consulta) => {
    const repositorio = repositorioEspia();
    const servidor = await levantar(RRHH, repositorio);

    const respuesta = await servidor.inject({ method: 'GET', url: `/api/notificaciones${consulta}` });

    expect(respuesta.statusCode).toBe(400);
    expect(repositorio.listados).toEqual([]);
  });
});

describe('fechas y faltas pedidas', () => {
  it('sólo acepta días reales', () => {
    expect(fechaIsoReal('2028-02-29')?.toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(fechaIsoReal('2026-02-29')).toBeNull();
    expect(fechaIsoReal('2026-13-01')).toBeNull();
  });

  it('descarta repetidas conservando el orden, y una fecha irreal invalida todo', () => {
    expect(
      faltasPedidas([
        { dni: '2', fecha: '2026-09-16', tipo: 'descanso' },
        { dni: '1', fecha: '2026-09-15', tipo: 'tardanza' },
        { dni: '2', fecha: '2026-09-16', tipo: 'descanso' },
      ]),
    ).toEqual([
      { dni: '2', fechaIso: '2026-09-16', tipo: 'descanso' },
      { dni: '1', fechaIso: '2026-09-15', tipo: 'tardanza' },
    ]);
    expect(faltasPedidas([{ dni: '1', fecha: '2026-04-31', tipo: 'tardanza' }])).toBeNull();
  });
});
