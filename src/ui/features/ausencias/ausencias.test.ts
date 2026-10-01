import { describe, expect, it } from 'vitest';

import {
  alternarVisibles,
  diasSeleccionados,
  estadoSeleccionGeneral,
  loteSinCambios,
  seleccionEfectiva,
  type FilaAusencia,
} from './ausencias.js';

function fila(dni: string, fechaIso: string, motivoId: number | null = null): FilaAusencia {
  const [anio, mes, dia] = fechaIso.split('-');
  return {
    clave: `${dni}|${fechaIso}`,
    dni,
    fechaIso,
    fechaStr: `${dia}/${mes}/${anio}`,
    fecha: new Date(`${fechaIso}T00:00:00Z`),
    usuario: `Persona ${dni}`,
    sector: 'Cocina',
    legajo: '',
    turnoRaw: '',
    partesRaw: '',
    motivoId,
    motivoSource: null,
    resueltoPor: null,
    adjuntos: [],
  };
}

const A = fila('1', '2026-01-05');
const B = fila('2', '2026-01-06');
const C = fila('3', '2026-01-07');

describe('selección efectiva', () => {
  it('es lo tildado que además está en pantalla', () => {
    const efectiva = seleccionEfectiva(new Set([A.clave, C.clave]), [A, B, C]);
    expect([...efectiva]).toEqual([A.clave, C.clave]);
  });

  it('una fila que salió de la tabla deja de contar aunque siga tildada', () => {
    // A filter, a period change, or "solo sin clasificar" dropping the rows just classified.
    const efectiva = seleccionEfectiva(new Set([A.clave, B.clave]), [B, C]);
    expect([...efectiva]).toEqual([B.clave]);
  });

  it('sin filas visibles no queda nada seleccionado', () => {
    expect(seleccionEfectiva(new Set([A.clave]), []).size).toBe(0);
  });
});

describe('casilla general', () => {
  it('vacía, parcial o completa sobre las filas visibles', () => {
    expect(estadoSeleccionGeneral(new Set(), [A, B])).toBe('ninguna');
    expect(estadoSeleccionGeneral(new Set([A.clave]), [A, B])).toBe('algunas');
    expect(estadoSeleccionGeneral(new Set([A.clave, B.clave]), [A, B])).toBe('todas');
  });

  it('una tabla vacía nunca está «todas»', () => {
    expect(estadoSeleccionGeneral(new Set(), [])).toBe('ninguna');
  });
});

describe('tildar o destildar las visibles', () => {
  it('tilda todas las visibles y conserva lo demás', () => {
    const siguiente = alternarVisibles(new Set(['oculta|2026-01-01']), [A, B], true);
    expect([...siguiente].sort()).toEqual([A.clave, B.clave, 'oculta|2026-01-01'].sort());
  });

  it('destilda sólo las visibles', () => {
    const siguiente = alternarVisibles(new Set([A.clave, C.clave]), [A, B], false);
    expect([...siguiente]).toEqual([C.clave]);
  });

  it('no modifica el conjunto que recibe', () => {
    const previas = new Set([A.clave]);
    alternarVisibles(previas, [A, B], true);
    expect([...previas]).toEqual([A.clave]);
  });
});

describe('días del lote', () => {
  it('salen en el orden de la tabla con la fecha cruda de la planilla', () => {
    expect(diasSeleccionados(new Set([C.clave, A.clave]), [A, B, C])).toEqual([
      { dni: '1', fechaStr: '05/01/2026' },
      { dni: '3', fechaStr: '07/01/2026' },
    ]);
  });
});

describe('lote sin cambios', () => {
  it('«Sin clasificar» sobre filas sin clasificar no cambia nada', () => {
    expect(loteSinCambios(new Set([A.clave, B.clave]), [A, B], null)).toBe(true);
  });

  it('basta una fila con otro motivo para que el lote cambie algo', () => {
    const clasificada = fila('4', '2026-01-08', 4);
    expect(loteSinCambios(new Set([A.clave, clasificada.clave]), [A, clasificada], 4)).toBe(false);
    expect(loteSinCambios(new Set([A.clave]), [A, clasificada], 4)).toBe(false);
  });

  it('sólo mira las filas seleccionadas', () => {
    const clasificada = fila('4', '2026-01-08', 4);
    expect(loteSinCambios(new Set([clasificada.clave]), [A, clasificada], 4)).toBe(true);
  });
});
