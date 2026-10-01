import { describe, expect, it } from 'vitest';

import { enLotes, ventanasDeConsulta } from './RepositorioNotificaciones.js';
import {
  CLAVE_ALMACEN_NOTIFICADAS,
  crearRepositorioNotificacionesLocal,
} from './repositorioNotificacionesLocal.js';

/** An in-memory `Storage`, enough for the offline adapter. */
function almacen(): Storage {
  const datos = new Map<string, string>();
  return {
    get length() {
      return datos.size;
    },
    clear: () => datos.clear(),
    getItem: (k) => datos.get(k) ?? null,
    key: (i) => [...datos.keys()][i] ?? null,
    removeItem: (k) => void datos.delete(k),
    setItem: (k, v) => void datos.set(k, v),
  };
}

/** A clock the test moves by hand. */
function reloj(inicio: string): { ahora: () => Date; avanzar: (iso: string) => void } {
  let actual = new Date(inicio);
  return { ahora: () => actual, avanzar: (iso) => (actual = new Date(iso)) };
}

describe('notificaciones sin servidor', () => {
  it('registrar dos veces no duplica y conserva la primera fecha de notificación', async () => {
    const storage = almacen();
    const tiempo = reloj('2026-09-20T10:00:00.000Z');
    const repo = crearRepositorioNotificacionesLocal(storage, tiempo.ahora);
    const clave = { dni: '1', fechaIso: '2026-09-15', tipo: 'tardanza' as const };

    await repo.registrar([clave, clave]);
    tiempo.avanzar('2026-09-25T10:00:00.000Z');
    await repo.registrar([clave, { dni: '1', fechaIso: '2026-09-16', tipo: 'descanso' }]);

    expect(await repo.listar('2026-09-01', '2026-09-30')).toEqual([
      { dni: '1', fecha: '2026-09-15', tipo: 'tardanza', notificadoAt: '2026-09-20T10:00:00.000Z' },
      { dni: '1', fecha: '2026-09-16', tipo: 'descanso', notificadoAt: '2026-09-25T10:00:00.000Z' },
    ]);
    const guardado = JSON.parse(storage.getItem(CLAVE_ALMACEN_NOTIFICADAS) ?? '{}') as object;
    expect(Object.keys(guardado)).toEqual(['1|2026-09-15|tardanza', '1|2026-09-16|descanso']);
  });

  it('lee sólo la ventana pedida, con los dos extremos incluidos', async () => {
    const repo = crearRepositorioNotificacionesLocal(almacen());
    await repo.registrar([
      { dni: '1', fechaIso: '2026-08-31', tipo: 'tardanza' },
      { dni: '1', fechaIso: '2026-09-01', tipo: 'tardanza' },
      { dni: '1', fechaIso: '2026-09-30', tipo: 'incompleta' },
      { dni: '1', fechaIso: '2026-10-01', tipo: 'tardanza' },
    ]);
    expect((await repo.listar('2026-09-01', '2026-09-30')).map((n) => n.fecha)).toEqual([
      '2026-09-01',
      '2026-09-30',
    ]);
  });

  it('sin almacenamiento disponible sigue funcionando en memoria', async () => {
    const repo = crearRepositorioNotificacionesLocal(null);
    await repo.registrar([{ dni: '1', fechaIso: '2026-09-15', tipo: 'tardanza' }]);
    expect(await repo.listar('2026-09-15', '2026-09-15')).toHaveLength(1);
  });

  it('un registro dañado se informa en lugar de leerse como vacío', async () => {
    const storage = almacen();
    storage.setItem(CLAVE_ALMACEN_NOTIFICADAS, '{roto');
    const repo = crearRepositorioNotificacionesLocal(storage);
    await expect(repo.listar('2026-09-01', '2026-09-30')).rejects.toThrow(/dañado/);
  });
});

describe('ventanas de consulta', () => {
  it('un período dentro del límite es una sola ventana', () => {
    expect(ventanasDeConsulta('2026-01-01', '2026-12-31')).toEqual([
      { desde: '2026-01-01', hasta: '2026-12-31' },
    ]);
  });

  it('un rango más largo se parte en ventanas seguidas, sin huecos ni solapamientos', () => {
    expect(ventanasDeConsulta('2026-09-01', '2026-09-10', 4)).toEqual([
      { desde: '2026-09-01', hasta: '2026-09-04' },
      { desde: '2026-09-05', hasta: '2026-09-08' },
      { desde: '2026-09-09', hasta: '2026-09-10' },
    ]);
  });

  it('parte una lista en lotes del tamaño pedido', () => {
    expect(enLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(enLotes([], 2)).toEqual([]);
  });
});
