import { describe, expect, it } from 'vitest';

import { claveAusencia, construirRegistroDia } from './dia.js';
import { ID_OLVIDO_FICHAR, ID_RECUPERA_HORAS } from './motivos.js';
import type { ConfiguracionFichadas, FilaQuickpass, TipoFalta } from './tipos.js';

/** A plausible full-day row. Every test overrides only the cells it is about. */
function fila(extra: FilaQuickpass = {}): FilaQuickpass {
  return {
    Sector: 'Depósito',
    Usuario: 'PEREZ JUAN',
    DNI: '30111222',
    Legajo: '145',
    Fecha: '05/02/2025',
    Turno: '08:00 - 17:00',
    Movimientos: '08:00 - 12:00 - 12:25 - 17:00',
    'Horas Turno': '9:00',
    Horas: '8:35',
    'Cantidad Tarde': '',
    Partes: '',
    ...extra,
  };
}

const tipos = (faltas: readonly { tipo: TipoFalta }[]): TipoFalta[] => faltas.map((f) => f.tipo);

describe('construirRegistroDia — día libre', () => {
  it('marks an empty turno as día libre and generates no faults', () => {
    const r = construirRegistroDia(fila({ Turno: '', Movimientos: '' }));
    expect(r.tipoDia).toBe('libre');
    expect(r.faltas).toEqual([]);
  });

  it('marks "F: 0hs" as día libre, so a franco never reaches absence or fault processing', () => {
    const r = construirRegistroDia(fila({ Turno: 'F: 0hs', Movimientos: '', Partes: 'Olvidó fichar' }));
    expect(r.tipoDia).toBe('libre');
    expect(r.esFlexible).toBe(false);
    expect(r.faltas).toEqual([]);
    expect(r.motivoId).toBeNull();
  });

  it('treats a non-zero "F:" as a flexible workday, not a franco', () => {
    const r = construirRegistroDia(fila({ Turno: 'F: 8hs' }));
    expect(r.tipoDia).toBe('trabajo');
    expect(r.esFlexible).toBe(true);
    expect(r.esDiaLibre).toBe(false);
  });
});

describe('construirRegistroDia — ausencia', () => {
  it('is an ausencia with no motivo when nobody punched and there is no note', () => {
    const r = construirRegistroDia(fila({ Movimientos: '' }));
    expect(r.tipoDia).toBe('ausencia');
    expect(r.motivoId).toBeNull();
    expect(r.motivoSource).toBeNull();
    expect(r.faltas).toEqual([]);
  });

  it('takes the motivo from the QUICKPASS note when there is no human decision yet', () => {
    const r = construirRegistroDia(fila({ Movimientos: '', Partes: 'Vacaciones' }));
    expect(r.motivoId).toBe(7);
    expect(r.motivoSource).toBe('partes');
  });

  it('lets a resolved absence override the QUICKPASS note', () => {
    const cfg: ConfiguracionFichadas = {
      ausencias: { [claveAusencia('30111222', '05/02/2025')]: { motivoId: 3 } },
    };
    const r = construirRegistroDia(fila({ Movimientos: '', Partes: 'Vacaciones' }), cfg);
    expect(r.motivoId).toBe(3);
    // A stored decision with no explicit origin is RRHH's own.
    expect(r.motivoSource).toBe('manual');
  });

  it('keeps the origin of a decision a manager made', () => {
    const cfg: ConfiguracionFichadas = {
      ausencias: {
        [claveAusencia('30111222', '05/02/2025')]: { motivoId: 4, motivoSource: 'encargado' },
      },
    };
    const r = construirRegistroDia(fila({ Movimientos: '' }), cfg);
    expect(r.motivoId).toBe(4);
    expect(r.motivoSource).toBe('encargado');
  });

  it('falls back to the note when the stored absence carries no motivo', () => {
    const cfg: ConfiguracionFichadas = {
      ausencias: { [claveAusencia('30111222', '05/02/2025')]: { motivoId: null } },
    };
    const r = construirRegistroDia(fila({ Movimientos: '', Partes: 'Feriado' }), cfg);
    expect(r.motivoId).toBe(5);
    expect(r.motivoSource).toBe('partes');
  });

  it('keys the stored absence by the raw Fecha cell, not by a reformatted date', () => {
    const cfg: ConfiguracionFichadas = {
      ausencias: { ['30111222|2025-02-05']: { motivoId: 3 } },
    };
    const r = construirRegistroDia(fila({ Movimientos: '' }), cfg);
    expect(r.motivoId).toBeNull();
  });
});

describe('construirRegistroDia — "Olvidó fichar" es el único motivo dual', () => {
  it('with zero punches: the day is an ausencia AND raises an incompleta fault', () => {
    const r = construirRegistroDia(fila({ Movimientos: '', Partes: 'Olvidó fichar (x4)' }));
    expect(r.tipoDia).toBe('ausencia');
    expect(r.motivoId).toBe(ID_OLVIDO_FICHAR);
    expect(r.motivoSource).toBe('partes');
    expect(tipos(r.faltas)).toEqual(['incompleta']);
    expect(r.faltas[0]?.olvidoFichar).toBe(true);
    expect(r.faltas[0]?.detalle).toBe('0 de 4 fichadas — parte QUICKPASS: Olvidó fichar (x4)');
  });

  it('no other absence motivo raises a fault', () => {
    for (const parte of ['Vacaciones', 'Enfermedad', 'Ausente sin Aviso', 'Recupera Horas']) {
      const r = construirRegistroDia(fila({ Movimientos: '', Partes: parte }));
      expect(r.tipoDia, parte).toBe('ausencia');
      expect(r.faltas, parte).toEqual([]);
    }
  });

  it('also raises the fault when RRHH resolved the absence as Olvidó fichar by hand', () => {
    const cfg: ConfiguracionFichadas = {
      ausencias: {
        [claveAusencia('30111222', '05/02/2025')]: { motivoId: ID_OLVIDO_FICHAR },
      },
    };
    const r = construirRegistroDia(fila({ Movimientos: '' }), cfg);
    expect(tipos(r.faltas)).toEqual(['incompleta']);
    expect(r.faltas[0]?.detalle).toBe('0 de 4 fichadas — parte QUICKPASS: ');
  });

  it('with partial punches: the day is trabajo and the note is appended to the detail', () => {
    const r = construirRegistroDia(
      fila({ Movimientos: '08:00 - 12:00', Partes: 'Olvidó fichar (x2)' }),
    );
    expect(r.tipoDia).toBe('trabajo');
    expect(tipos(r.faltas)).toEqual(['incompleta']);
    expect(r.faltas[0]?.olvidoFichar).toBe(true);
    expect(r.faltas[0]?.detalle).toBe('2 de 4 fichadas — parte QUICKPASS: Olvidó fichar (x2)');
  });

  it('raises the fault even when every required punch is there, because the note says one was forgotten', () => {
    const r = construirRegistroDia(fila({ Partes: 'Olvidó fichar (x1)' }));
    expect(r.tipoDia).toBe('trabajo');
    expect(tipos(r.faltas)).toEqual(['incompleta']);
    expect(r.faltas[0]?.detalle).toBe('4 de 4 fichadas — parte QUICKPASS: Olvidó fichar (x1)');
  });

  it('does not set olvidoFichar on a plain incompleta', () => {
    const r = construirRegistroDia(fila({ Movimientos: '08:00 - 12:00' }));
    expect(r.faltas[0]?.detalle).toBe('2 de 4 fichadas');
    expect(r.faltas[0]?.olvidoFichar).toBe(false);
  });
});

describe('construirRegistroDia — personas excluidas', () => {
  const cfg: ConfiguracionFichadas = { dniExcluidos: ['30111222'] };

  it('still produces a full record, because the hours keep counting in the report', () => {
    const r = construirRegistroDia(
      fila({ Movimientos: '08:00 - 12:00 - 13:30 - 17:00', 'Cantidad Tarde': '0:45' }),
      cfg,
    );
    expect(r.excluido).toBe(true);
    expect(r.tipoDia).toBe('trabajo');
    expect(r.horasBrutas).toBe(515);
    expect(r.descansoReal).toBe(90);
  });

  it('emits no faults at all, however many rules the day breaks', () => {
    const r = construirRegistroDia(
      fila({
        Movimientos: '08:00 - 12:00 - 13:30',
        'Cantidad Tarde': '0:45',
        Partes: 'Olvidó fichar',
      }),
      cfg,
    );
    expect(r.faltas).toEqual([]);
  });

  it('emits no fault on the Olvidó fichar absence path either', () => {
    const r = construirRegistroDia(fila({ Movimientos: '', Partes: 'Olvidó fichar' }), cfg);
    expect(r.tipoDia).toBe('ausencia');
    expect(r.motivoId).toBe(ID_OLVIDO_FICHAR);
    expect(r.faltas).toEqual([]);
  });

  it('does not exclude a different DNI', () => {
    const r = construirRegistroDia(fila({ DNI: '30111223', Movimientos: '08:00 - 12:00' }), cfg);
    expect(r.excluido).toBe(false);
    expect(tipos(r.faltas)).toEqual(['incompleta']);
  });
});

describe('construirRegistroDia — descanso', () => {
  it('measures the real break as the gap between the second and third punch', () => {
    const r = construirRegistroDia(fila({ Movimientos: '08:00 - 12:00 - 12:25 - 17:00' }));
    expect(r.descansoReal).toBe(25);
    expect(tipos(r.faltas)).toEqual([]);
  });

  it('raises a descanso fault when the break runs over the maximum', () => {
    const r = construirRegistroDia(fila({ Movimientos: '08:00 - 12:00 - 13:05 - 17:00' }));
    expect(r.descansoReal).toBe(65);
    expect(tipos(r.faltas)).toEqual(['descanso']);
    expect(r.faltas[0]?.detalle).toBe('1:05 de descanso (máx 30 min)');
  });

  it('respects a configured maximum', () => {
    const r = construirRegistroDia(fila({ Movimientos: '08:00 - 12:00 - 13:05 - 17:00' }), {
      descansoMaxMin: 90,
    });
    expect(r.faltas).toEqual([]);
  });

  it('does not measure a break when only 3 punches of 4 exist but the third is missing', () => {
    const r = construirRegistroDia(fila({ Movimientos: '08:00 - 12:00' }));
    expect(r.descansoReal).toBe(0);
    expect(tipos(r.faltas)).toEqual(['incompleta']);
  });

  it('does not measure a break in a sector that only punches twice', () => {
    const r = construirRegistroDia(
      fila({ Sector: 'Reparto', Movimientos: '08:00 - 12:00 - 13:05 - 17:00' }),
      { reglasSector: { Reparto: 2 } },
    );
    expect(r.fichadasRequeridas).toBe(2);
    expect(r.descansoReal).toBe(0);
    expect(r.faltas).toEqual([]);
  });

  it('measures the break from the 3rd punch even when the 4th is missing', () => {
    const r = construirRegistroDia(fila({ Movimientos: '08:00 - 12:00 - 13:05' }));
    expect(r.descansoReal).toBe(65);
    expect(tipos(r.faltas)).toEqual(['incompleta', 'descanso']);
  });
});

describe('construirRegistroDia — tardanza', () => {
  it('raises a tardanza naming the shift start', () => {
    const r = construirRegistroDia(fila({ 'Cantidad Tarde': '0:12' }));
    expect(tipos(r.faltas)).toEqual(['tardanza']);
    expect(r.faltas[0]?.detalle).toBe('0:12 tarde (turno 08:00)');
  });

  it('never raises a tardanza on a flexible shift — there is no start to be late against', () => {
    const r = construirRegistroDia(fila({ Turno: 'F: 8hs', 'Cantidad Tarde': '1:00' }));
    expect(r.esFlexible).toBe(true);
    expect(r.faltas).toEqual([]);
  });

  it('never raises a tardanza when the turno has no parseable start', () => {
    const r = construirRegistroDia(fila({ Turno: 'ROTATIVO', 'Cantidad Tarde': '1:00' }));
    expect(r.esFlexible).toBe(false);
    expect(r.inicioTurno).toBeNull();
    expect(r.faltas).toEqual([]);
  });

  it('respects the configured tolerance and does not fire exactly at it', () => {
    const cfg: ConfiguracionFichadas = { toleranciaMin: 10 };
    expect(construirRegistroDia(fila({ 'Cantidad Tarde': '0:10' }), cfg).faltas).toEqual([]);
    expect(tipos(construirRegistroDia(fila({ 'Cantidad Tarde': '0:11' }), cfg).faltas)).toEqual([
      'tardanza',
    ]);
  });

  it('ignores a negative Cantidad Tarde — arriving early is not a fault', () => {
    const r = construirRegistroDia(fila({ 'Cantidad Tarde': '-0:20' }));
    expect(r.cantidadTarde).toBe(-20);
    expect(r.faltas).toEqual([]);
  });
});

describe('construirRegistroDia — el registro completo', () => {
  it('carries the evidence the report and the notification need', () => {
    const r = construirRegistroDia(fila({ Partes: 'nota cualquiera' }));
    expect(r).toMatchObject({
      sector: 'Depósito',
      usuario: 'PEREZ JUAN',
      dni: '30111222',
      legajo: '145',
      fechaStr: '05/02/2025',
      inicioSemana: '2025-02-03',
      cantidadMovimientos: 4,
      fichadasRequeridas: 4,
      horasTurno: 540,
      horasBrutas: 515,
      turnoRaw: '08:00 - 17:00',
      partesRaw: 'nota cualquiera',
      excluido: false,
    });
    expect(r.fecha?.toISOString()).toBe('2025-02-05T00:00:00.000Z');
  });

  it('accumulates every independent fault of the same day', () => {
    const r = construirRegistroDia(
      fila({ Movimientos: '08:00 - 12:00 - 13:05', 'Cantidad Tarde': '0:30' }),
    );
    expect(tipos(r.faltas)).toEqual(['incompleta', 'descanso', 'tardanza']);
  });

  it('survives a row with no usable date without attributing it to a week', () => {
    const r = construirRegistroDia(fila({ Fecha: 'sin fecha' }));
    expect(r.fecha).toBeNull();
    expect(r.inicioSemana).toBeNull();
  });

  it('falls back to 4 required fichadas when the sector rule is missing or zero', () => {
    expect(construirRegistroDia(fila()).fichadasRequeridas).toBe(4);
    expect(
      construirRegistroDia(fila(), { reglasSector: { 'Depósito': 0 } }).fichadasRequeridas,
    ).toBe(4);
  });

  it('does not raise an incompleta in a 2-fichada sector that punched twice', () => {
    const r = construirRegistroDia(fila({ Sector: 'Cocina', Movimientos: '08:00 - 17:00' }), {
      reglasSector: { Cocina: 2 },
    });
    expect(r.faltas).toEqual([]);
  });

  it('classifies Recupera Horas from the note as an absence that does not pay', () => {
    const r = construirRegistroDia(fila({ Movimientos: '', Partes: 'Recupera Horas' }));
    expect(r.motivoId).toBe(ID_RECUPERA_HORAS);
    expect(r.faltas).toEqual([]);
  });
});
