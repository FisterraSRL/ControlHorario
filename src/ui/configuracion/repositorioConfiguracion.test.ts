import { describe, expect, it } from 'vitest';

import { leerParametros } from './repositorioConfiguracionHttp.js';
import { crearRepositorioConfiguracionLocal } from './repositorioConfiguracionLocal.js';

const CLAVE = 'controlhorario.configuracion.v1';

/** A Storage that lives in a Map: enough for the adapter, and isolated per test. */
function almacen(inicial: Record<string, string> = {}): Storage {
  const datos = new Map(Object.entries(inicial));
  return {
    get length() {
      return datos.size;
    },
    clear: () => datos.clear(),
    getItem: (k) => datos.get(k) ?? null,
    key: (i) => [...datos.keys()][i] ?? null,
    removeItem: (k) => {
      datos.delete(k);
    },
    setItem: (k, v) => {
      datos.set(k, v);
    },
  };
}

const VIEJOS = { descansoMaxMin: 45, toleranciaMin: 5, horasTurnoSemanales: 48 };

describe('parámetros que devuelve el servidor', () => {
  it('una API anterior al campo nuevo no rompe la lectura: se usa el valor por defecto', () => {
    expect(leerParametros(VIEJOS)).toEqual({ ...VIEJOS, tardanzasPerdonadasSemana: 1 });
  });

  it('respeta el valor que manda el servidor, incluido el cero', () => {
    expect(leerParametros({ ...VIEJOS, tardanzasPerdonadasSemana: 0 })?.tardanzasPerdonadasSemana).toBe(0);
    expect(leerParametros({ ...VIEJOS, tardanzasPerdonadasSemana: 3 })?.tardanzasPerdonadasSemana).toBe(3);
  });

  it('rechaza un valor presente que no es un número', () => {
    expect(leerParametros({ ...VIEJOS, tardanzasPerdonadasSemana: '2' })).toBeNull();
    expect(leerParametros({ ...VIEJOS, tardanzasPerdonadasSemana: null })).toBeNull();
  });

  it('sigue exigiendo los tres parámetros de siempre', () => {
    expect(leerParametros({ descansoMaxMin: 30, toleranciaMin: 0 })).toBeNull();
    expect(leerParametros(null)).toBeNull();
  });
});

describe('configuración local', () => {
  it('arranca con una tardanza perdonada por semana', async () => {
    const repo = crearRepositorioConfiguracionLocal(almacen());
    expect((await repo.leer()).parametros.tardanzasPerdonadasSemana).toBe(1);
  });

  it('un guardado anterior al campo nuevo conserva sus valores y recibe el valor por defecto', async () => {
    const repo = crearRepositorioConfiguracionLocal(
      almacen({ [CLAVE]: JSON.stringify({ parametros: VIEJOS }) }),
    );
    expect((await repo.leer()).parametros).toEqual({ ...VIEJOS, tardanzasPerdonadasSemana: 1 });
  });

  it('guarda el valor elegido y lo vuelve a leer', async () => {
    const storage = almacen({ [CLAVE]: JSON.stringify({ parametros: VIEJOS }) });
    await crearRepositorioConfiguracionLocal(storage).guardarParametros({ tardanzasPerdonadasSemana: 0 });
    const leida = await crearRepositorioConfiguracionLocal(storage).leer();
    expect(leida.parametros).toEqual({ ...VIEJOS, tardanzasPerdonadasSemana: 0 });
  });
});
