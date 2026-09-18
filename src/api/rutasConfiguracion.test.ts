import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { appConSesion, sesionDePrueba } from './pruebas/dobles.js';
import type { RepositorioConfiguracionAzureSql } from './repositorioConfiguracion.js';
import { registrarRutasConfiguracion } from './rutasConfiguracion.js';
import type { Sesion } from './sesiones.js';

/** Every write throws: a route that reaches the repository has already failed this test. */
function repositorioIntocable(tocado: string[]): RepositorioConfiguracionAzureSql {
  const prohibido = (nombre: string) => (): never => {
    tocado.push(nombre);
    throw new Error(`Una escritura llegó a ${nombre}.`);
  };
  return {
    leer: () =>
      Promise.resolve({
        parametros: { descansoMaxMin: 30, toleranciaMin: 0, horasTurnoSemanales: 51 },
        reglasSector: {},
        motivos: [],
        exclusiones: [],
      }),
    paraElMotor: prohibido('paraElMotor'),
    guardarParametros: prohibido('guardarParametros'),
    guardarReglaSector: prohibido('guardarReglaSector'),
    crearMotivo: prohibido('crearMotivo'),
    editarMotivo: prohibido('editarMotivo'),
    retirarMotivo: prohibido('retirarMotivo'),
    agregarExclusion: prohibido('agregarExclusion'),
    quitarExclusion: prohibido('quitarExclusion'),
    sembrarExclusiones: prohibido('sembrarExclusiones'),
  };
}

/** Every write of Configuración, as the deny-list has to cover it. */
const ESCRITURAS = [
  { method: 'PATCH' as const, url: '/api/configuracion/parametros', payload: { toleranciaMin: 5 } },
  {
    method: 'PUT' as const,
    url: '/api/configuracion/sectores',
    payload: { sector: 'Cocina', fichadasRequeridas: 4 },
  },
  {
    method: 'POST' as const,
    url: '/api/configuracion/motivos',
    payload: { label: 'Nuevo', worked: true },
  },
  { method: 'PATCH' as const, url: '/api/configuracion/motivos/4', payload: { worked: false } },
  { method: 'DELETE' as const, url: '/api/configuracion/motivos/4', payload: undefined },
  { method: 'POST' as const, url: '/api/configuracion/exclusiones', payload: { dni: '11000001' } },
  { method: 'DELETE' as const, url: '/api/configuracion/exclusiones', payload: { dni: '11000001' } },
];

let app: FastifyInstance | null = null;

async function levantar(sesion: Sesion): Promise<{
  readonly app: FastifyInstance;
  readonly tocado: string[];
}> {
  const tocado: string[] = [];
  app = await appConSesion(sesion, (instancia) => {
    registrarRutasConfiguracion(instancia, { repositorio: repositorioIntocable(tocado) });
  });
  return { app, tocado };
}

afterEach(async () => {
  await app?.close();
  app = null;
});

describe('Configuración con una sesión de encargado', () => {
  it.each(ESCRITURAS)('$method $url responde 403', async (escritura) => {
    const { app: servidor, tocado } = await levantar(
      sesionDePrueba({ rol: 'encargado', sectores: ['Cocina'] }),
    );

    const respuesta = await servidor.inject({
      method: escritura.method,
      url: escritura.url,
      ...(escritura.payload ? { payload: escritura.payload } : {}),
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json()).toMatchObject({ error: 'solo_rrhh' });
    expect(tocado).toEqual([]);
  });

  it('puede leer la configuración: la necesita para clasificar un día', async () => {
    const { app: servidor } = await levantar(
      sesionDePrueba({ rol: 'encargado', sectores: ['Cocina'] }),
    );

    const respuesta = await servidor.inject({ method: 'GET', url: '/api/configuracion' });

    expect(respuesta.statusCode).toBe(200);
  });
});

describe('Configuración con una sesión de RRHH', () => {
  it('un operador sí llega a la escritura', async () => {
    const { app: servidor, tocado } = await levantar(sesionDePrueba({ rol: 'operador' }));

    // The double throws on purpose: reaching it is the whole assertion, and a 500 from the
    // fake proves the guard let the request through instead of answering 403 for everybody.
    const respuesta = await servidor.inject({
      method: 'PATCH',
      url: '/api/configuracion/parametros',
      payload: { toleranciaMin: 5 },
    });

    expect(respuesta.statusCode).not.toBe(403);
    expect(tocado).toEqual(['guardarParametros']);
  });
});
