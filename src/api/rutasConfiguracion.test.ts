import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { appConSesion, sesionDePrueba } from './pruebas/dobles.js';
import type { RepositorioConfiguracionAzureSql } from './repositorioConfiguracion.js';
import { registrarRutasConfiguracion } from './rutasConfiguracion.js';
import type { DependenciasSincronizacion } from './sincronizacionAusencias.js';
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
        parametros: {
          descansoMaxMin: 30,
          toleranciaMin: 0,
          horasTurnoSemanales: 51,
          tardanzasPerdonadasSemana: 1,
        },
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

/** The registry re-derivation, recording each step into the same trail as the writes. */
function sincronizacionRegistradora(
  tocado: string[],
  falla = false,
): Pick<DependenciasSincronizacion, 'fichadas' | 'ausencias'> {
  return {
    fichadas: {
      listar: (alcance) => {
        tocado.push(`listar:${alcance === null ? 'todo' : 'recortado'}`);
        return Promise.resolve([]);
      },
    },
    ausencias: {
      sincronizar: (_filas, cfg, actor) => {
        tocado.push(`sincronizar:${actor}:${(cfg.motivos ?? []).map((m) => m.id).join(',')}`);
        if (falla) return Promise.reject(new Error('se cayó la conexión'));
        return Promise.resolve({ vigentes: 0, creadas: 0, refrescadas: 0, podadas: 0 });
      },
    },
  };
}

/** A repository whose motivo writes succeed, recording the order of every call. */
function repositorioDeMotivos(tocado: string[], retirado = true): RepositorioConfiguracionAzureSql {
  return {
    ...repositorioIntocable(tocado),
    paraElMotor: () => {
      tocado.push('paraElMotor');
      return Promise.resolve({ motivos: [{ id: 10, label: 'Trámite médico', worked: true }] });
    },
    crearMotivo: (label, worked) => {
      tocado.push('crearMotivo');
      return Promise.resolve({ id: 10, label, worked });
    },
    editarMotivo: (id, worked) => {
      tocado.push('editarMotivo');
      return Promise.resolve({ id, label: 'Trámite médico', worked });
    },
    retirarMotivo: () => {
      tocado.push('retirarMotivo');
      return Promise.resolve(retirado);
    },
  };
}

let app: FastifyInstance | null = null;

async function levantar(
  sesion: Sesion,
  opciones: {
    readonly repositorio?: (tocado: string[]) => RepositorioConfiguracionAzureSql;
    readonly fallaSincronizacion?: boolean;
  } = {},
): Promise<{
  readonly app: FastifyInstance;
  readonly tocado: string[];
}> {
  const tocado: string[] = [];
  const repositorio = (opciones.repositorio ?? repositorioIntocable)(tocado);
  app = await appConSesion(sesion, (instancia) => {
    registrarRutasConfiguracion(instancia, {
      repositorio,
      ...sincronizacionRegistradora(tocado, opciones.fallaSincronizacion),
    });
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

describe('Crear o retirar un motivo vuelve a derivar el registro de ausencias', () => {
  const RESINCRONIZACION = ['paraElMotor', 'listar:todo', 'sincronizar:rrhh@ejemplo.test:10'];

  it('crear un motivo sincroniza después de escribirlo y antes de responder', async () => {
    const { app: servidor, tocado } = await levantar(sesionDePrueba({ rol: 'admin' }), {
      repositorio: repositorioDeMotivos,
    });

    const respuesta = await servidor.inject({
      method: 'POST',
      url: '/api/configuracion/motivos',
      payload: { label: 'Trámite médico', worked: true },
    });

    expect(respuesta.statusCode).toBe(201);
    // The sync reads the configuration AFTER the write, so the new motivo is in its list.
    expect(tocado).toEqual(['crearMotivo', ...RESINCRONIZACION]);
  });

  it('retirar un motivo sincroniza para que su etiqueta deje de aplicarse', async () => {
    const { app: servidor, tocado } = await levantar(sesionDePrueba({ rol: 'admin' }), {
      repositorio: repositorioDeMotivos,
    });

    const respuesta = await servidor.inject({ method: 'DELETE', url: '/api/configuracion/motivos/10' });

    expect(respuesta.statusCode).toBe(204);
    expect(tocado).toEqual(['retirarMotivo', ...RESINCRONIZACION]);
  });

  it('un motivo que no existía no sincroniza nada', async () => {
    const { app: servidor, tocado } = await levantar(sesionDePrueba({ rol: 'admin' }), {
      repositorio: (t) => repositorioDeMotivos(t, false),
    });

    const respuesta = await servidor.inject({ method: 'DELETE', url: '/api/configuracion/motivos/99' });

    expect(respuesta.statusCode).toBe(404);
    expect(tocado).toEqual(['retirarMotivo']);
  });

  it('cambiar si un motivo cuenta como trabajado no sincroniza: ningún id cambia', async () => {
    const { app: servidor, tocado } = await levantar(sesionDePrueba({ rol: 'admin' }), {
      repositorio: repositorioDeMotivos,
    });

    const respuesta = await servidor.inject({
      method: 'PATCH',
      url: '/api/configuracion/motivos/10',
      payload: { worked: false },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(tocado).toEqual(['editarMotivo']);
  });

  it('si la sincronización falla, el motivo creado sigue siendo un 201', async () => {
    const { app: servidor, tocado } = await levantar(sesionDePrueba({ rol: 'admin' }), {
      repositorio: repositorioDeMotivos,
      fallaSincronizacion: true,
    });

    const respuesta = await servidor.inject({
      method: 'POST',
      url: '/api/configuracion/motivos',
      payload: { label: 'Trámite médico', worked: true },
    });

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.json()).toMatchObject({ motivo: { id: 10 } });
    expect(tocado).toEqual(['crearMotivo', ...RESINCRONIZACION]);
  });
});

describe('Tardanzas perdonadas por semana', () => {
  /** A repository whose parameter write succeeds and echoes what it was given. */
  function repositorioDeParametros(tocado: string[]): RepositorioConfiguracionAzureSql {
    return {
      ...repositorioIntocable(tocado),
      guardarParametros: (cambios) => {
        tocado.push(`guardarParametros:${JSON.stringify(cambios)}`);
        return Promise.resolve({
          descansoMaxMin: 30,
          toleranciaMin: 0,
          horasTurnoSemanales: 51,
          tardanzasPerdonadasSemana: 1,
          ...cambios,
        });
      },
    };
  }

  it.each([0, 1, 7])('acepta %i', async (valor) => {
    const { app: servidor, tocado } = await levantar(sesionDePrueba({ rol: 'admin' }), {
      repositorio: repositorioDeParametros,
    });

    const respuesta = await servidor.inject({
      method: 'PATCH',
      url: '/api/configuracion/parametros',
      payload: { tardanzasPerdonadasSemana: valor },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toMatchObject({ parametros: { tardanzasPerdonadasSemana: valor } });
    expect(tocado).toEqual([`guardarParametros:{"tardanzasPerdonadasSemana":${valor}}`]);
  });

  it.each([8, -1, 1.5, '2'])('rechaza %j sin escribir', async (valor) => {
    const { app: servidor, tocado } = await levantar(sesionDePrueba({ rol: 'admin' }), {
      repositorio: repositorioDeParametros,
    });

    const respuesta = await servidor.inject({
      method: 'PATCH',
      url: '/api/configuracion/parametros',
      payload: { tardanzasPerdonadasSemana: valor },
    });

    expect(respuesta.statusCode).toBe(400);
    expect(tocado).toEqual([]);
  });

  it('la lectura lo devuelve junto con los demás parámetros', async () => {
    const { app: servidor } = await levantar(sesionDePrueba({ rol: 'admin' }));

    const respuesta = await servidor.inject({ method: 'GET', url: '/api/configuracion' });

    expect(respuesta.json()).toMatchObject({ parametros: { tardanzasPerdonadasSemana: 1 } });
  });
});
