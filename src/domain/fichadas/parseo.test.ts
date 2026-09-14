import { describe, expect, it } from 'vitest';

import {
  domingoDe,
  fmtFechaAR,
  fmtFechaISO,
  fmtMinutos,
  fmtReloj,
  infoTurno,
  lunesDe,
  normalizarNombre,
  parsearFechaDMY,
  parsearHM,
  parsearMovimientos,
} from './parseo.js';

describe('parsearHM', () => {
  it('reads a negative value as negative minutes, because QUICKPASS reports deficits that way', () => {
    expect(parsearHM('-1:30')).toBe(-90);
    expect(parsearHM('-0:05')).toBe(-5);
  });

  it('treats the empty cell and the dash placeholder as nothing to report', () => {
    expect(parsearHM('')).toBe(0);
    expect(parsearHM('-')).toBe(0);
    expect(parsearHM('   ')).toBe(0);
    expect(parsearHM(null)).toBe(0);
    expect(parsearHM(undefined)).toBe(0);
  });

  it('never returns NaN for an unparseable cell', () => {
    expect(parsearHM('ocho horas')).toBe(0);
    expect(parsearHM('8:5')).toBe(0);
    expect(parsearHM('8.30')).toBe(0);
  });

  it('reads hours past 24 without wrapping', () => {
    expect(parsearHM('51:00')).toBe(3060);
  });
});

describe('infoTurno', () => {
  const casos: ReadonlyArray<
    readonly [string, string, { esDiaLibre: boolean; esFlexible: boolean; inicio: number | null }]
  > = [
    ['empty cell is día libre', '', { esDiaLibre: true, esFlexible: false, inicio: null }],
    [
      'the all-zeros range is día libre',
      '00:00 - 00:00',
      { esDiaLibre: true, esFlexible: false, inicio: null },
    ],
    ['"F: 0hs" is a franco, not a flexible shift', 'F: 0hs', { esDiaLibre: true, esFlexible: false, inicio: null }],
    ['"F: 0" is a franco', 'F: 0', { esDiaLibre: true, esFlexible: false, inicio: null }],
    ['"F: 0.0hs" is a franco', 'F: 0.0hs', { esDiaLibre: true, esFlexible: false, inicio: null }],
    [
      '"F: 0,00hs" is a franco — the export uses the comma decimal separator',
      'F: 0,00hs',
      { esDiaLibre: true, esFlexible: false, inicio: null },
    ],
    ['"F:0hs" with no space is a franco', 'F:0hs', { esDiaLibre: true, esFlexible: false, inicio: null }],
    ['"f: 0hs" lowercase is a franco', 'f: 0hs', { esDiaLibre: true, esFlexible: false, inicio: null }],
    [
      'a non-zero "F:" value stays a flexible shift',
      'F: 8hs',
      { esDiaLibre: false, esFlexible: true, inicio: null },
    ],
    [
      '"F: 0,5hs" is a real half-shift, not a franco',
      'F: 0,5hs',
      { esDiaLibre: false, esFlexible: true, inicio: null },
    ],
    [
      'a bare "F:" with no parseable number stays flexible rather than becoming a franco',
      'F:',
      { esDiaLibre: false, esFlexible: true, inicio: null },
    ],
    [
      'a malformed "F: hs" stays flexible',
      'F: hs',
      { esDiaLibre: false, esFlexible: true, inicio: null },
    ],
    [
      'a normal range exposes its start in minutes',
      '08:30 - 17:00',
      { esDiaLibre: false, esFlexible: false, inicio: 510 },
    ],
    [
      'a one-digit hour is accepted',
      '8:00 - 17:00',
      { esDiaLibre: false, esFlexible: false, inicio: 480 },
    ],
    [
      'an unrecognised turno is a workday with no start to be late against',
      'ROTATIVO',
      { esDiaLibre: false, esFlexible: false, inicio: null },
    ],
  ];

  it.each(casos)('%s', (_nombre, entrada, esperado) => {
    expect(infoTurno(entrada)).toEqual(esperado);
  });
});

describe('parsearMovimientos', () => {
  it('reads the dash-separated punch list in sheet order', () => {
    expect(parsearMovimientos('08:00 - 12:05 - 12:30 - 17:02')).toEqual([480, 725, 750, 1022]);
  });

  it('is empty when nobody punched', () => {
    expect(parsearMovimientos('')).toEqual([]);
    expect(parsearMovimientos(null)).toEqual([]);
  });

  it('drops an unparseable punch instead of losing the whole day', () => {
    expect(parsearMovimientos('08:00 - ?? - 17:00')).toEqual([480, 1020]);
  });
});

describe('fechas (siempre UTC)', () => {
  it('parses DD/MM/YYYY at UTC midnight, so the host timezone cannot shift the day', () => {
    const d = parsearFechaDMY('03/02/2025');
    expect(d?.toISOString()).toBe('2025-02-03T00:00:00.000Z');
  });

  it('rejects anything that is not exactly DD/MM/YYYY', () => {
    expect(parsearFechaDMY('3/2/2025')).toBeNull();
    expect(parsearFechaDMY('2025-02-03')).toBeNull();
    expect(parsearFechaDMY('')).toBeNull();
  });

  it('puts a Sunday in the week that started the previous Monday', () => {
    // 2025-02-09 is a Sunday.
    expect(fmtFechaISO(lunesDe(parsearFechaDMY('09/02/2025') as Date))).toBe('2025-02-03');
    expect(fmtFechaISO(domingoDe(parsearFechaDMY('09/02/2025') as Date))).toBe('2025-02-09');
  });

  it('leaves a Monday on its own week start', () => {
    expect(fmtFechaISO(lunesDe(parsearFechaDMY('03/02/2025') as Date))).toBe('2025-02-03');
  });

  it('renders a date the way Argentina reads it', () => {
    expect(fmtFechaAR(parsearFechaDMY('03/02/2025'))).toBe('03/02/2025');
    expect(fmtFechaAR(null)).toBe('');
  });
});

describe('formato de minutos', () => {
  it('renders a negative total with its sign', () => {
    expect(fmtMinutos(-90)).toBe('-1:30');
    expect(fmtMinutos(90)).toBe('1:30');
    expect(fmtMinutos(0)).toBe('0:00');
  });

  it('zero-pads a clock time', () => {
    expect(fmtReloj(480)).toBe('08:00');
    expect(fmtReloj(1022)).toBe('17:02');
  });
});

describe('normalizarNombre', () => {
  it('matches the same person spelled with and without accents', () => {
    expect(normalizarNombre('  ramón  josé  pérez ')).toBe('RAMON JOSE PEREZ');
    expect(normalizarNombre('RAMON JOSE PEREZ')).toBe('RAMON JOSE PEREZ');
  });

  it('collapses repeated whitespace and trims', () => {
    expect(normalizarNombre('\tAna   Maria \n')).toBe('ANA MARIA');
  });

  it('is empty for an empty cell', () => {
    expect(normalizarNombre(null)).toBe('');
    expect(normalizarNombre(undefined)).toBe('');
  });
});
