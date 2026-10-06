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
  it.each([true, false])('reactivates a retired reason across reloads with worked=%s', async (worked) => {
    const storage = almacen();
    const repo = crearRepositorioConfiguracionLocal(storage);
    const original = await repo.crearMotivo('Trámite', !worked);
    await repo.retirarMotivo(original.id);
    expect((await repo.leer()).motivos.some((m) => m.id === original.id)).toBe(false);

    const reopened = crearRepositorioConfiguracionLocal(storage);
    await reopened.guardarParametros({ toleranciaMin: 5 });
    const restored = await reopened.crearMotivo(' Trámite ', worked);
    expect(restored).toEqual({ ...original, worked });
    expect((await reopened.leer()).motivos.filter((m) => m.id === original.id)).toEqual([restored]);
    expect(await reopened.leer()).not.toHaveProperty('motivosRetirados');
  });

  it('never reuses a retired identity for a different label', async () => {
    const repo = crearRepositorioConfiguracionLocal(null);
    const original = await repo.crearMotivo('Trámite', true);
    await repo.retirarMotivo(original.id);
    const other = await repo.crearMotivo('Otro', false);
    expect(other.id).toBeGreaterThan(original.id);
    expect((await repo.crearMotivo('Trámite', true)).id).toBe(original.id);
  });

  it('rejects active duplicates without changing the original worked flag', async () => {
    const repo = crearRepositorioConfiguracionLocal(null);
    const original = await repo.crearMotivo('Trámite', true);
    await expect(repo.crearMotivo(' trámite ', false)).rejects.toThrow('Ya existe ese motivo.');
    expect((await repo.leer()).motivos.filter((m) => m.id === original.id)).toEqual([original]);
  });

  it('preserves existing browser configuration without retirement metadata', async () => {
    const storage = almacen({
      [CLAVE]: JSON.stringify({ motivos: [{ id: 20, label: 'Anterior', worked: true }] }),
    });
    const repo = crearRepositorioConfiguracionLocal(storage);
    expect((await repo.crearMotivo('Nuevo', false)).id).toBe(21);
    await repo.retirarMotivo(20);
    expect(await repo.crearMotivo('Anterior', false)).toEqual({ id: 20, label: 'Anterior', worked: false });
  });

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
