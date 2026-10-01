import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  alElegir,
  bandaVisible,
  claveDia,
  diaUTC,
  estadoDia,
  etiquetaDia,
  moverFoco,
  semanasDelMes,
  sumarMeses,
  tituloMes,
} from './grillaMes.js';

// The whole suite runs west of Greenwich, where the operators are. Under UTC a calendar built
// with `new Date(y, m, d)` would pass every assertion below by coincidence; under UTC-3 its
// "midnight" is 03:00Z and the ISO comparisons fail. Node re-reads TZ on assignment.
const TZ_ORIGINAL = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'America/Argentina/Buenos_Aires';
});
afterAll(() => {
  if (TZ_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ORIGINAL;
});

/** September 2026: the 1st is a Tuesday, the 14th a Monday. */
const SEP: { anio: number; mes: number } = { anio: 2026, mes: 8 };

describe('zona horaria', () => {
  it('la suite corre de verdad en UTC-3', () => {
    // If this ever fails the rest of the file stops proving anything about the UTC trap.
    expect(new Date(2026, 8, 1).getTimezoneOffset()).toBe(180);
  });

  it('cada día de la grilla es medianoche UTC, no medianoche local', () => {
    for (const semana of semanasDelMes(SEP)) {
      for (const dia of semana) expect(dia.toISOString()).toMatch(/T00:00:00\.000Z$/);
    }
    expect(semanasDelMes(SEP)[0]?.[0]?.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('la clave del día no se corre al día anterior', () => {
    expect(claveDia(diaUTC(2026, 8, 1))).toBe('2026-09-01');
  });
});

describe('grilla del mes', () => {
  it('son seis semanas de lunes a domingo', () => {
    const semanas = semanasDelMes(SEP);
    expect(semanas).toHaveLength(6);
    for (const semana of semanas) {
      expect(semana).toHaveLength(7);
      expect(semana[0]?.getUTCDay()).toBe(1);
      expect(semana[6]?.getUTCDay()).toBe(0);
    }
  });

  it('contiene el mes entero, en orden y sin huecos', () => {
    const delMes = semanasDelMes(SEP)
      .flat()
      .filter((d) => d.getUTCMonth() === 8)
      .map(claveDia);
    expect(delMes).toHaveLength(30);
    expect(delMes[0]).toBe('2026-09-01');
    expect(delMes[29]).toBe('2026-09-30');
  });

  it('un mes que empieza en domingo arranca seis días antes, no en la semana siguiente', () => {
    // 1/11/2026 is a Sunday: `getUTCDay()` is 0 and a naive grid would open on 2/11.
    expect(claveDia(semanasDelMes({ anio: 2026, mes: 10 })[0]?.[0] ?? new Date(0))).toBe('2026-10-26');
  });

  it('un mes que empieza en lunes arranca ese mismo día', () => {
    expect(claveDia(semanasDelMes({ anio: 2026, mes: 5 })[0]?.[0] ?? new Date(0))).toBe('2026-06-01');
  });

  it('sumar meses cruza el año en ambos sentidos', () => {
    expect(sumarMeses({ anio: 2026, mes: 11 }, 1)).toEqual({ anio: 2027, mes: 0 });
    expect(sumarMeses({ anio: 2026, mes: 0 }, -1)).toEqual({ anio: 2025, mes: 11 });
  });
});

describe('dos clicks', () => {
  const d10 = diaUTC(2026, 8, 10);
  const d20 = diaUTC(2026, 8, 20);

  it('el primer click fija la fecha desde y espera la segunda', () => {
    expect(alElegir(null, d10)).toEqual({ tipo: 'desde', desde: d10 });
  });

  it('el segundo click cierra el rango', () => {
    expect(alElegir(d10, d20)).toEqual({ tipo: 'completo', desde: d10, hasta: d20 });
  });

  it('si el segundo día es anterior, los invierte', () => {
    expect(alElegir(d20, d10)).toEqual({ tipo: 'completo', desde: d10, hasta: d20 });
  });

  it('el mismo día dos veces es un rango de un día', () => {
    expect(alElegir(d10, d10)).toEqual({ tipo: 'completo', desde: d10, hasta: d10 });
  });
});

describe('banda', () => {
  const actual = { desde: diaUTC(2026, 8, 1), hasta: diaUTC(2026, 8, 7) };
  const d10 = diaUTC(2026, 8, 10);

  it('sin nada pendiente pinta el rango vigente', () => {
    expect(bandaVisible(actual, null, d10)).toBe(actual);
  });

  it('con la fecha desde pendiente pinta la vista previa hasta el día señalado, en orden', () => {
    expect(bandaVisible(actual, d10, diaUTC(2026, 8, 15))).toEqual({ desde: d10, hasta: diaUTC(2026, 8, 15) });
    expect(bandaVisible(actual, d10, diaUTC(2026, 8, 5))).toEqual({ desde: diaUTC(2026, 8, 5), hasta: d10 });
    expect(bandaVisible(actual, d10, null)).toEqual({ desde: d10, hasta: d10 });
  });

  it('distingue los extremos de los días del medio', () => {
    expect(estadoDia(actual.desde, actual)).toEqual({ inicio: true, fin: false, medio: false });
    expect(estadoDia(diaUTC(2026, 8, 4), actual)).toEqual({ inicio: false, fin: false, medio: true });
    expect(estadoDia(actual.hasta, actual)).toEqual({ inicio: false, fin: true, medio: false });
    expect(estadoDia(diaUTC(2026, 8, 8), actual)).toEqual({ inicio: false, fin: false, medio: false });
  });
});

describe('teclado', () => {
  const clave = (d: Date | null) => (d ? claveDia(d) : null);

  it('las flechas mueven por día y por semana, cruzando el mes', () => {
    expect(clave(moverFoco(diaUTC(2026, 8, 30), 'ArrowRight'))).toBe('2026-10-01');
    expect(clave(moverFoco(diaUTC(2026, 8, 1), 'ArrowLeft'))).toBe('2026-08-31');
    expect(clave(moverFoco(diaUTC(2026, 8, 3), 'ArrowUp'))).toBe('2026-08-27');
    expect(clave(moverFoco(diaUTC(2026, 8, 28), 'ArrowDown'))).toBe('2026-10-05');
  });

  it('Inicio y Fin van al lunes y al domingo de la semana, también desde un domingo', () => {
    expect(clave(moverFoco(diaUTC(2026, 8, 17), 'Home'))).toBe('2026-09-14');
    expect(clave(moverFoco(diaUTC(2026, 8, 17), 'End'))).toBe('2026-09-20');
    expect(clave(moverFoco(diaUTC(2026, 8, 20), 'Home'))).toBe('2026-09-14');
    expect(clave(moverFoco(diaUTC(2026, 8, 20), 'End'))).toBe('2026-09-20');
  });

  it('RePág/AvPág cambian de mes sin desbordar y con Shift de año', () => {
    expect(clave(moverFoco(diaUTC(2026, 0, 31), 'PageDown'))).toBe('2026-02-28');
    expect(clave(moverFoco(diaUTC(2026, 2, 31), 'PageUp'))).toBe('2026-02-28');
    expect(clave(moverFoco(diaUTC(2026, 8, 17), 'PageUp', true))).toBe('2025-09-17');
  });

  it('cualquier otra tecla no mueve el foco', () => {
    expect(moverFoco(diaUTC(2026, 8, 17), 'Enter')).toBeNull();
    expect(moverFoco(diaUTC(2026, 8, 17), 'Tab')).toBeNull();
  });
});

describe('textos', () => {
  it('cada día se anuncia con la fecha completa', () => {
    expect(etiquetaDia(diaUTC(2026, 8, 17))).toBe('jueves 17 de septiembre de 2026');
    expect(etiquetaDia(diaUTC(2026, 10, 1))).toBe('domingo 1 de noviembre de 2026');
  });

  it('el título del mes va con mayúscula inicial', () => {
    expect(tituloMes(SEP)).toBe('Septiembre 2026');
  });
});
