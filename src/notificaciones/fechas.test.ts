import { describe, expect, it } from 'vitest';

import { MESES, fechaLarga } from './fechas.js';

describe('fechaLarga', () => {
  it('names every month, in lowercase Spanish', () => {
    expect(MESES).toEqual([
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ]);
    for (let mes = 0; mes < 12; mes++) {
      expect(fechaLarga(new Date(Date.UTC(2026, mes, 15)))).toBe(`15 de ${MESES[mes]} de 2026`);
    }
  });

  it('writes the day without a leading zero', () => {
    expect(fechaLarga(new Date(Date.UTC(2026, 0, 1)))).toBe('1 de enero de 2026');
    expect(fechaLarga(new Date(Date.UTC(2026, 8, 9)))).toBe('9 de septiembre de 2026');
    expect(fechaLarga(new Date(Date.UTC(2026, 8, 14)))).toBe('14 de septiembre de 2026');
  });

  it('handles both ends of the year', () => {
    expect(fechaLarga(new Date(Date.UTC(2025, 11, 31)))).toBe('31 de diciembre de 2025');
    expect(fechaLarga(new Date(Date.UTC(2026, 0, 1)))).toBe('1 de enero de 2026');
  });

  it('handles the leap day', () => {
    expect(fechaLarga(new Date(Date.UTC(2024, 1, 29)))).toBe('29 de febrero de 2024');
    // 2100 is not a leap year, so the 29th rolls into March. That is Date's arithmetic,
    // not this function's, and the function reports what it is handed.
    expect(fechaLarga(new Date(Date.UTC(2100, 1, 29)))).toBe('1 de marzo de 2100');
  });

  it('reads the date in UTC, never in local time', () => {
    // This is the whole reason the legacy used getUTC*: the fichadas engine parses every
    // Fecha cell to UTC midnight, and Argentina is UTC-3. Read locally, a UTC-midnight
    // date would print as the day before for every single row.
    expect(fechaLarga(new Date('2026-03-01T00:00:00Z'))).toBe('1 de marzo de 2026');
    expect(fechaLarga(new Date('2026-03-01T00:00:00-03:00'))).toBe('1 de marzo de 2026');
    expect(fechaLarga(new Date('2026-02-28T23:59:59Z'))).toBe('28 de febrero de 2026');
    // 21:00 in Buenos Aires on the 28th is already the 1st in UTC.
    expect(fechaLarga(new Date('2026-02-28T21:30:00-03:00'))).toBe('1 de marzo de 2026');
  });

  it('handles dates far outside the working range without wrapping', () => {
    expect(fechaLarga(new Date(Date.UTC(1970, 0, 1)))).toBe('1 de enero de 1970');
    expect(fechaLarga(new Date(Date.UTC(1899, 11, 30)))).toBe('30 de diciembre de 1899');
    expect(fechaLarga(new Date(Date.UTC(2999, 11, 31)))).toBe('31 de diciembre de 2999');
  });

  it('renders a year before 1000 without padding it', () => {
    const d = new Date(Date.UTC(2026, 5, 1));
    d.setUTCFullYear(99);
    expect(fechaLarga(d)).toBe('1 de junio de 99');
  });

  it('produces the legacy string for an invalid date, rather than throwing', () => {
    // Kept as-is on purpose: an unparseable date is a data problem upstream, and this
    // module does not get to decide what such a document should say. Reported, not fixed.
    expect(fechaLarga(new Date('no es una fecha'))).toBe('NaN de undefined de NaN');
  });
});
