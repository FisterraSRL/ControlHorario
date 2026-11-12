import { describe, expect, it } from 'vitest';

import { construirRegistroDia } from '../../../domain/fichadas/index.js';
import { construirIrregularidades, rangoDeLiquidacion, ultimaFechaCargada } from './cierre.js';

describe('período de liquidación', () => {
  it.each([
    ['2026-11', 25, '2026-10-26', '2026-11-25'],
    ['2026-01', 25, '2025-12-26', '2026-01-25'],
    ['2026-02', 30, '2026-01-31', '2026-02-28'],
    ['2026-03', 30, '2026-03-01', '2026-03-30'],
    ['2028-02', 31, '2028-02-01', '2028-02-29'],
    ['2028-03', 31, '2028-03-01', '2028-03-31'],
    ['2026-10', 1, '2026-09-02', '2026-10-01'],
  ])('cuts %s on day %d', (mes, corte, desde, hasta) => {
    expect(rangoDeLiquidacion(mes, corte)).toEqual({ desde: new Date(desde), hasta: new Date(hasta) });
  });
});

describe('revisión de irregularidades', () => {
  const dia = construirRegistroDia({ Usuario: 'Persona ficticia', Sector: 'Fábrica', DNI: '001',
    Fecha: '12/11/2026', Movimientos: '08:10 12:00 13:00 16:00', Turno: '08:00 - 16:00' });

  it('joins reviews by person, day and type without changing the derived faults', () => {
    const registro = { ...dia, faltas: [
      { tipo: 'tardanza', detalle: 'Llegada 10 minutos tarde' },
      { tipo: 'descanso', detalle: 'Descanso de 60 minutos' },
    ] } as const;
    const filas = construirIrregularidades([registro], [
      { dni: '001', fecha: '2026-11-12', tipo: 'tardanza', estado: 'justificada', nota: 'Trámite' },
      { dni: '002', fecha: '2026-11-12', tipo: 'descanso', estado: 'revisada', nota: '' },
      { dni: '001', fecha: '2026-11-13', tipo: 'descanso', estado: 'revisada', nota: '' },
    ]);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ tipo: 'tardanza', decision: { estado: 'justificada', nota: 'Trámite' } });
    expect(filas[1]).toMatchObject({ tipo: 'descanso', decision: null });
    expect(registro.faltas).toHaveLength(2);
  });

  it('reports the latest loaded date and tolerates an empty period', () => {
    expect(ultimaFechaCargada([])).toBeNull();
    expect(ultimaFechaCargada([dia, { ...dia, fecha: new Date('2026-11-10') }])).toEqual(new Date('2026-11-12'));
  });
});
