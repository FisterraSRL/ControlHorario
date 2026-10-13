import { describe, expect, it } from 'vitest';

import {
  alternarVisibles,
  diasSeleccionados,
  estadoSeleccionGeneral,
  loteSinCambios,
  seleccionEfectiva,
  registrarClasificacionReciente,
  filasRecientes,
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

describe('recent classification context', () => {
  const contexto = {};
  const inicial = { contexto, claves: new Set<string>() };

  it('adds a successful single classification without changing the original selection', () => {
    const siguiente = registrarClasificacionReciente(inicial, contexto, [{ dni: '1', fechaStr: '05/01/2026' }], 4, true);
    expect([...siguiente.claves]).toEqual(['1|2026-01-05']);
    expect([...inicial.claves]).toEqual([]);
  });

  it('retains every successful batch day, merging without duplicate panels', () => {
    const previa = { contexto, claves: new Set(['1|2026-01-05']) };
    const siguiente = registrarClasificacionReciente(previa, contexto, [
      { dni: '1', fechaStr: '05/01/2026' }, { dni: '2', fechaStr: '06/01/2026' },
    ], 4, true);
    expect([...siguiente.claves]).toEqual(['1|2026-01-05', '2|2026-01-06']);
  });

  it('does not retain a failed classification or lose earlier panels', () => {
    const previa = { contexto, claves: new Set(['2|2026-01-06']) };
    const siguiente = registrarClasificacionReciente(previa, contexto, [{ dni: '1', fechaStr: '05/01/2026' }], 4, false);
    expect([...siguiente.claves]).toEqual(['2|2026-01-06']);
  });

  it('removes an unclassified day while preserving other recent days', () => {
    const previa = { contexto, claves: new Set(['1|2026-01-05', '2|2026-01-06']) };
    const siguiente = registrarClasificacionReciente(previa, contexto, [{ dni: '1', fechaStr: '05/01/2026' }], null, true);
    expect([...siguiente.claves]).toEqual(['2|2026-01-06']);
  });

  it('ignores completion from a period/filter context that has been discarded', () => {
    const siguiente = registrarClasificacionReciente(inicial, {}, [{ dni: '1', fechaStr: '05/01/2026' }], 4, true);
    expect([...siguiente.claves]).toEqual([]);
  });

  it('derives current classified records and attachments without including pending or filtered days', () => {
    const adjunto = { id: '1', dni: '1', fecha: '2026-01-05', nombre: 'prueba.pdf', bytes: 20, tipoMime: 'application/pdf', subidoPor: null, subidoAt: '2026-01-05T10:00:00Z' };
    const actualizada = { ...A, motivoId: 4, adjuntos: [adjunto] };
    const recientes = filasRecientes(new Set([A.clave, B.clave, C.clave]), [actualizada, B]);
    expect(recientes).toEqual([actualizada]);
    expect(recientes[0]?.adjuntos).toEqual([adjunto]);
    expect(seleccionEfectiva(new Set([A.clave, B.clave]), [B])).toEqual(new Set(['2|2026-01-06']));
  });
});

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
