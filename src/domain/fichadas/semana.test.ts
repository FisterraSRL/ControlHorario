import { describe, expect, it } from 'vitest';

import { construirRegistroDia } from './dia.js';
import { reporteSemanal } from './semana.js';
import type { ConfiguracionFichadas, FilaQuickpass, RegistroDia } from './tipos.js';

function fila(extra: FilaQuickpass = {}): FilaQuickpass {
  return {
    Sector: 'Depósito',
    Usuario: 'PEREZ JUAN',
    DNI: '30111222',
    Legajo: '145',
    Fecha: '03/02/2025',
    Turno: '08:00 - 17:00',
    Movimientos: '08:00 - 12:00 - 12:25 - 17:00',
    'Horas Turno': '9:00',
    Horas: '8:35',
    'Cantidad Tarde': '',
    Partes: '',
    ...extra,
  };
}

function registros(filas: readonly FilaQuickpass[], cfg: ConfiguracionFichadas = {}): RegistroDia[] {
  return filas.map((f) => construirRegistroDia(f, cfg));
}

/** Monday to Friday of the week of 2025-02-03. */
const SEMANA = ['03/02/2025', '04/02/2025', '05/02/2025', '06/02/2025', '07/02/2025'] as const;

describe('reporteSemanal — agrupación', () => {
  it('produces one row per person and week', () => {
    const out = reporteSemanal(
      registros([
        ...SEMANA.map((Fecha) => fila({ Fecha })),
        fila({ Fecha: '10/02/2025' }),
        fila({ DNI: '30999888', Usuario: 'GOMEZ ANA', Fecha: '03/02/2025' }),
      ]),
    );
    expect(out.map((s) => `${s.dni}@${s.inicioSemana}`)).toEqual([
      '30999888@2025-02-03',
      '30111222@2025-02-03',
      '30111222@2025-02-10',
    ]);
  });

  it('puts a Sunday in the week that started the previous Monday', () => {
    const out = reporteSemanal(registros([fila({ Fecha: '09/02/2025' })]));
    expect(out).toHaveLength(1);
    expect(out[0]?.inicioSemana).toBe('2025-02-03');
  });

  it('drops a row that cannot be attributed — no date or no DNI', () => {
    const out = reporteSemanal(registros([fila({ Fecha: 'sin fecha' }), fila({ DNI: '' })]));
    expect(out).toEqual([]);
  });

  it('sorts by sector, then person, then week', () => {
    const out = reporteSemanal(
      registros([
        fila({ Sector: 'Reparto', Usuario: 'ZARATE B', DNI: '3' }),
        fila({ Sector: 'Cocina', Usuario: 'ALVAREZ A', DNI: '1' }),
        fila({ Sector: 'Reparto', Usuario: 'ABALOS C', DNI: '2' }),
      ]),
    );
    expect(out.map((s) => `${s.sector}/${s.usuario}`)).toEqual([
      'Cocina/ALVAREZ A',
      'Reparto/ABALOS C',
      'Reparto/ZARATE B',
    ]);
  });
});

describe('reporteSemanal — horas', () => {
  it('sums only worked days into horasTrabajadas, and their real breaks into horasDescanso', () => {
    const out = reporteSemanal(
      registros([
        ...SEMANA.slice(0, 4).map((Fecha) => fila({ Fecha })),
        fila({ Fecha: '07/02/2025', Movimientos: '', Horas: '' }),
      ]),
    );
    expect(out[0]?.horasTrabajadas).toBe(515 * 4);
    expect(out[0]?.horasDescanso).toBe(25 * 4);
  });

  it('applies one global contractual figure to everyone, defaulting to 51 hours', () => {
    const out = reporteSemanal(
      registros([fila(), fila({ DNI: '30999888', Usuario: 'GOMEZ ANA', Sector: 'Cocina' })]),
    );
    expect(out.map((s) => s.horasTurno)).toEqual([51 * 60, 51 * 60]);
  });

  it('lets the contractual figure be configured', () => {
    const out = reporteSemanal(registros([fila()]), { horasTurnoSemanales: 45 });
    expect(out[0]?.horasTurno).toBe(45 * 60);
  });

  it('reports the difference against the contractual week', () => {
    const out = reporteSemanal(registros(SEMANA.map((Fecha) => fila({ Fecha }))));
    expect(out[0]?.horasTrabajadas).toBe(2575);
    expect(out[0]?.diferencia).toBe(2575 - 3060);
  });

  it('pays an absence whose motivo counts as worked, using the contractual shift of that day', () => {
    const out = reporteSemanal(
      registros([fila({ Fecha: '05/02/2025', Movimientos: '', Horas: '', Partes: 'Vacaciones' })]),
    );
    expect(out[0]?.horasJustificadas).toBe(540);
    expect(out[0]?.horasTrabajadas).toBe(0);
    expect(out[0]?.diasAusenciaSinClasificar).toBe(0);
  });

  it('does not pay an absence whose motivo does not count as worked', () => {
    const out = reporteSemanal(
      registros([
        fila({ Fecha: '05/02/2025', Movimientos: '', Horas: '', Partes: 'Ausente sin Aviso' }),
      ]),
    );
    expect(out[0]?.horasJustificadas).toBe(0);
    expect(out[0]?.diasAusenciaSinClasificar).toBe(0);
  });

  it('counts an absence with no motivo as pending — "sin clasificar" is the absence of a motivo', () => {
    const out = reporteSemanal(
      registros([
        fila({ Fecha: '05/02/2025', Movimientos: '', Horas: '' }),
        fila({ Fecha: '06/02/2025', Movimientos: '', Horas: '' }),
      ]),
    );
    expect(out[0]?.diasAusenciaSinClasificar).toBe(2);
    expect(out[0]?.horasJustificadas).toBe(0);
  });

  it('follows a caller-supplied closed list when deciding what a motivo pays', () => {
    const filas = [fila({ Fecha: '05/02/2025', Movimientos: '', Horas: '', Partes: 'Vacaciones' })];
    const out = reporteSemanal(registros(filas), {
      motivos: [{ id: 7, label: 'Vacaciones', worked: false }],
    });
    expect(out[0]?.horasJustificadas).toBe(0);
  });

  it('ignores días libres entirely — they neither work nor justify hours', () => {
    const out = reporteSemanal(
      registros([fila(), fila({ Fecha: '08/02/2025', Turno: 'F: 0hs', Movimientos: '', Horas: '' })]),
    );
    expect(out[0]?.dias).toHaveLength(2);
    expect(out[0]?.horasTrabajadas).toBe(515);
    expect(out[0]?.diasAusenciaSinClasificar).toBe(0);
  });

  it('keeps counting the hours of an excluded person', () => {
    const out = reporteSemanal(registros([fila()], { dniExcluidos: ['30111222'] }), {
      dniExcluidos: ['30111222'],
    });
    expect(out[0]?.horasTrabajadas).toBe(515);
  });
});

describe('reporteSemanal — sector de la semana', () => {
  it('reports the sector the person worked most that week', () => {
    const out = reporteSemanal(
      registros([
        fila({ Fecha: '03/02/2025', Sector: 'Depósito' }),
        fila({ Fecha: '04/02/2025', Sector: 'Reparto' }),
        fila({ Fecha: '05/02/2025', Sector: 'Reparto' }),
      ]),
    );
    expect(out[0]?.sector).toBe('Reparto');
  });

  it('keeps the first sector seen when two are equally frequent', () => {
    const out = reporteSemanal(
      registros([
        fila({ Fecha: '03/02/2025', Sector: 'Depósito' }),
        fila({ Fecha: '04/02/2025', Sector: 'Reparto' }),
      ]),
    );
    expect(out[0]?.sector).toBe('Depósito');
  });
});

describe('reporteSemanal — la evidencia queda adjunta', () => {
  it('keeps every day record of the week so the notification can cite them', () => {
    const out = reporteSemanal(registros(SEMANA.map((Fecha) => fila({ Fecha }))));
    expect(out[0]?.dias.map((d) => d.fechaStr)).toEqual([...SEMANA]);
  });

  it('is a pure function: the same input always produces the same output', () => {
    const entrada = registros(SEMANA.map((Fecha) => fila({ Fecha })));
    expect(reporteSemanal(entrada)).toEqual(reporteSemanal(entrada));
  });
});
