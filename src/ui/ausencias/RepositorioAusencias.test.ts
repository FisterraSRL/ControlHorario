import { describe, expect, it } from 'vitest';

import type { RepositorioFichadas } from '../historial/RepositorioFichadas.js';
import { reemplazarAusencias, type AusenciaRegistrada } from './RepositorioAusencias.js';
import { crearRepositorioAusenciasLocal } from './repositorioAusenciasLocal.js';

function ausencia(dni: string, fecha: string, motivoId: number | null): AusenciaRegistrada {
  return {
    dni,
    fecha,
    motivoId,
    motivoSource: motivoId === null ? null : 'manual',
    resueltoPor: null,
    resueltoAt: null,
    adjuntos: 0,
  };
}

describe('reemplazo del registro después de un lote', () => {
  it('reemplaza en su lugar cada fila devuelta y deja las demás', () => {
    const previas = [
      ausencia('1', '2026-01-05', null),
      ausencia('2', '2026-01-06', null),
      ausencia('3', '2026-01-07', null),
    ];
    const resultado = reemplazarAusencias(previas, [
      ausencia('3', '2026-01-07', 4),
      ausencia('1', '2026-01-05', 4),
    ]);
    expect(resultado.map((a) => [a.dni, a.motivoId])).toEqual([
      ['1', 4],
      ['2', null],
      ['3', 4],
    ]);
  });

  it('agrega al final una fila que el registro todavía no tenía', () => {
    const resultado = reemplazarAusencias(
      [ausencia('1', '2026-01-05', null)],
      [ausencia('9', '2026-01-09', 4)],
    );
    expect(resultado.map((a) => a.dni)).toEqual(['1', '9']);
  });

  it('un lote vacío devuelve el mismo registro', () => {
    const previas = [ausencia('1', '2026-01-05', null)];
    expect(reemplazarAusencias(previas, [])).toBe(previas);
  });
});

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

// `asignarMotivos` never reads the historial, so the fichadas port is not exercised here.
const SIN_FICHADAS = {} as RepositorioFichadas;

describe('clasificación en lote sin servidor', () => {
  it('guarda todos los días como decisión manual y no repite ninguno', async () => {
    const storage = almacen();
    const repo = crearRepositorioAusenciasLocal(SIN_FICHADAS, storage);

    const filas = await repo.asignarMotivos(
      [
        { dni: '1', fechaStr: '05/01/2026' },
        { dni: '2', fechaStr: '06/01/2026' },
        { dni: '1', fechaStr: '05/01/2026' },
      ],
      4,
    );

    expect(filas.map((f) => [f.dni, f.fecha, f.motivoId, f.motivoSource])).toEqual([
      ['1', '2026-01-05', 4, 'manual'],
      ['2', '2026-01-06', 4, 'manual'],
    ]);
    const guardado = JSON.parse(storage.getItem('controlhorario.ausencias.v1') ?? '{}') as object;
    expect(Object.keys(guardado).sort()).toEqual(['1|2026-01-05', '2|2026-01-06']);
  });

  it('una fecha ilegible no guarda ninguno', async () => {
    const storage = almacen();
    const repo = crearRepositorioAusenciasLocal(SIN_FICHADAS, storage);

    await expect(
      repo.asignarMotivos(
        [
          { dni: '1', fechaStr: '05/01/2026' },
          { dni: '2', fechaStr: '2026-01-06' },
        ],
        4,
      ),
    ).rejects.toThrow();
    expect(storage.getItem('controlhorario.ausencias.v1')).toBeNull();
  });
});

describe('registro sin servidor y motivos creados en Configuración', () => {
  const fichadas = {
    listar: () =>
      Promise.resolve([
        {
          DNI: '1',
          Fecha: '05/01/2026',
          Turno: '08:00 - 17:00',
          Movimientos: '',
          Partes: 'Trámite médico',
        },
      ]),
  } as unknown as RepositorioFichadas;

  it('toma de la nota el motivo activo que nombra, igual que el servidor', async () => {
    const repo = crearRepositorioAusenciasLocal(fichadas, almacen(), () =>
      Promise.resolve([{ id: 10, label: 'Tramite medico', worked: true }]),
    );

    const [fila] = await repo.listar();

    expect([fila?.motivoId, fila?.motivoSource]).toEqual([10, 'partes']);
  });

  it('sin la lista de motivos sólo reconoce los patrones fijos', async () => {
    const repo = crearRepositorioAusenciasLocal(fichadas, almacen());

    const [fila] = await repo.listar();

    expect([fila?.motivoId, fila?.motivoSource]).toEqual([null, null]);
  });
});
