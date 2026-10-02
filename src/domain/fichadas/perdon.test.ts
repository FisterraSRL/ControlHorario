import { describe, expect, it } from 'vitest';

import { construirRegistroDia } from './dia.js';
import { perdonarTardanzas } from './perdon.js';
import type { Falta, RegistroDia } from './tipos.js';

const TARDE: Falta = { tipo: 'tardanza', detalle: '0:15 tarde (turno 08:00)' };
const DESCANSO: Falta = { tipo: 'descanso', detalle: '1:00 de descanso (máx 30 min)' };
const INCOMPLETA: Falta = { tipo: 'incompleta', detalle: '2 de 4 fichadas', olvidoFichar: false };

/** September 2026: the 14th and the 21st are Mondays, the 20th is a Sunday. */
function dia(n: number, faltas: readonly Falta[] = [TARDE], dni = '30111222'): RegistroDia {
  const fecha = new Date(Date.UTC(2026, 8, n));
  const lunes = n >= 21 ? 21 : n >= 14 ? 14 : 7;
  return {
    sector: 'Administración', usuario: 'Persona', dni, legajo: '1', fecha,
    fechaStr: `${String(n).padStart(2, '0')}/09/2026`,
    inicioSemana: `2026-09-${String(lunes).padStart(2, '0')}`,
    cantidadMovimientos: 4, movimientos: [495, 720, 780, 960], turnoRaw: '08:00 - 16:00',
    esDiaLibre: false, esFlexible: false, inicioTurno: 480, fichadasRequeridas: 4,
    horasTurno: 480, horasBrutas: 465, cantidadTarde: 15, partesRaw: '', descansoReal: 60,
    faltas, tipoDia: 'trabajo', motivoId: null, motivoSource: null, excluido: false,
  };
}

const tardanzas = (rs: readonly RegistroDia[]) =>
  rs.map((r) => r.faltas.filter((f) => f.tipo === 'tardanza').length);

describe('perdón semanal de tardanzas', () => {
  it('con 0 no perdona nada y no toca ningún registro', () => {
    const entrada = [dia(14), dia(15)];
    const salida = perdonarTardanzas(entrada, 0);
    expect(salida).toEqual(entrada);
    expect(salida[0]).toBe(entrada[0]);
    expect(salida[0]?.tardanzaPerdonada).toBeUndefined();
  });

  it('un valor negativo o no finito tampoco perdona', () => {
    expect(tardanzas(perdonarTardanzas([dia(14)], -1))).toEqual([1]);
    expect(tardanzas(perdonarTardanzas([dia(14)], Number.NaN))).toEqual([1]);
  });

  it('con 1 perdona sólo la primera tardanza de la semana', () => {
    expect(tardanzas(perdonarTardanzas([dia(14), dia(15), dia(16)], 1))).toEqual([0, 1, 1]);
  });

  it('con 2 perdona las dos primeras', () => {
    expect(tardanzas(perdonarTardanzas([dia(14), dia(15), dia(16)], 2))).toEqual([0, 0, 1]);
  });

  it('cada semana tiene su propio cupo', () => {
    const salida = perdonarTardanzas([dia(14), dia(15), dia(21), dia(22)], 1);
    expect(tardanzas(salida)).toEqual([0, 1, 0, 1]);
  });

  it('el domingo pertenece a la semana que empezó el lunes anterior', () => {
    // The 20th is the Sunday of the week of the 14th: it uses the same allowance.
    const salida = perdonarTardanzas([dia(20), dia(21)], 1);
    expect(salida[0]?.inicioSemana).toBe('2026-09-14');
    expect(tardanzas(salida)).toEqual([0, 0]);
    expect(tardanzas(perdonarTardanzas([dia(14), dia(20)], 1))).toEqual([0, 1]);
  });

  it('el domingo calculado por el motor cae en la semana del lunes anterior', () => {
    const domingo = construirRegistroDia({ Fecha: '20/09/2026' });
    expect(domingo.inicioSemana).toBe('2026-09-14');
  });

  it('cada persona tiene su propio cupo', () => {
    const salida = perdonarTardanzas([dia(14, [TARDE], 'A'), dia(15, [TARDE], 'B'), dia(16, [TARDE], 'A')], 1);
    expect(tardanzas(salida)).toEqual([0, 0, 1]);
  });

  it('no toca las faltas que no son tardanza ni las cuenta para el cupo', () => {
    const salida = perdonarTardanzas([dia(14, [INCOMPLETA]), dia(15, [DESCANSO]), dia(16)], 1);
    expect(salida[0]?.faltas).toEqual([INCOMPLETA]);
    expect(salida[1]?.faltas).toEqual([DESCANSO]);
    expect(salida[2]?.faltas).toEqual([]);
  });

  it('un día con tardanza y descanso conserva el descanso', () => {
    const [unico] = perdonarTardanzas([dia(14, [DESCANSO, TARDE])], 1);
    expect(unico?.faltas).toEqual([DESCANSO]);
    expect(unico?.tardanzaPerdonada).toEqual(TARDE);
  });

  it('expone la tardanza perdonada y deja intactos los demás días', () => {
    const entrada = [dia(14), dia(15)];
    const salida = perdonarTardanzas(entrada, 1);
    expect(salida[0]?.tardanzaPerdonada).toEqual(TARDE);
    expect(salida[1]).toBe(entrada[1]);
    expect(salida[1]?.tardanzaPerdonada).toBeUndefined();
    // The input is never mutated.
    expect(entrada[0]?.faltas).toEqual([TARDE]);
    expect(entrada[0]?.tardanzaPerdonada).toBeUndefined();
  });

  it('perdona por orden cronológico aunque la entrada venga desordenada', () => {
    const salida = perdonarTardanzas([dia(16), dia(14), dia(15)], 1);
    expect(salida.map((r) => r.fechaStr)).toEqual(['16/09/2026', '14/09/2026', '15/09/2026']);
    expect(tardanzas(salida)).toEqual([1, 0, 1]);
  });

  it('un registro sin fecha no tiene semana y nunca se perdona', () => {
    const sinFecha: RegistroDia = { ...dia(14), fecha: null, fechaStr: 'ilegible', inicioSemana: null };
    const salida = perdonarTardanzas([sinFecha, dia(15)], 1);
    expect(tardanzas(salida)).toEqual([1, 0]);
  });
});
