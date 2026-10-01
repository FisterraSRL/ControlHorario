import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cambiarModoPeriodo,
  crearPeriodo,
  crearRango,
  dentroDelPeriodo,
  desplazarPeriodo,
  etiquetaAncla,
  etiquetaPeriodo,
  hoyUTC,
  periodoInicial,
  rangoDelPeriodo,
  semanasParciales,
} from './periodo.js';

/** September 2026: the 14th is a Monday and the 20th is the Sunday that closes its week. */
function dia(n: number): Date {
  return new Date(Date.UTC(2026, 8, n));
}

const LUNES = 1;

describe('ancla de la semana', () => {
  it('lleva cualquier día de la semana a su lunes', () => {
    for (let n = 14; n <= 20; n++) {
      const periodo = crearPeriodo('semana', dia(n));
      expect(periodo.ancla.getTime()).toBe(dia(14).getTime());
      expect(periodo.ancla.getUTCDay()).toBe(LUNES);
    }
  });

  it('trata el domingo como cierre de su semana y no como apertura de la siguiente', () => {
    // El caso que rompe un `getUTCDay()` ingenuo: el domingo es 0, no 7.
    expect(crearPeriodo('semana', dia(20)).ancla.getTime()).toBe(dia(14).getTime());
    expect(crearPeriodo('semana', dia(21)).ancla.getTime()).toBe(dia(21).getTime());
  });

  it('el período inicial siempre abre en lunes', () => {
    expect(periodoInicial().modo).toBe('semana');
    expect(periodoInicial().ancla.getUTCDay()).toBe(LUNES);
  });

  it('desplazarse hacia adelante y hacia atrás mantiene el lunes', () => {
    let periodo = crearPeriodo('semana', dia(17));
    for (const direccion of [1, 1, -1, -1, -1] as const) {
      periodo = desplazarPeriodo(periodo, direccion);
      expect(periodo.ancla.getUTCDay()).toBe(LUNES);
    }
    expect(periodo.ancla.getTime()).toBe(dia(7).getTime());
  });

  it('volver a semana desde otro modo vuelve a encajar en lunes', () => {
    const mes = crearPeriodo('mes', dia(17));
    expect(mes.ancla.getTime()).toBe(dia(17).getTime());
    expect(crearPeriodo('semana', mes.ancla).ancla.getTime()).toBe(dia(14).getTime());
  });

  it('no toca el ancla de los otros modos', () => {
    // En modo día el ancla ES el día elegido: encajarla en lunes haría imposible mirar un martes.
    expect(crearPeriodo('dia', dia(17)).ancla.getTime()).toBe(dia(17).getTime());
    expect(crearPeriodo('mes', dia(17)).ancla.getTime()).toBe(dia(17).getTime());
    expect(crearPeriodo('anio', dia(17)).ancla.getTime()).toBe(dia(17).getTime());
  });

  it('la etiqueta del header muestra el lunes, no el día en que se abrió la app', () => {
    expect(etiquetaAncla(crearPeriodo('semana', dia(17)).ancla)).toBe('14 sep 2026');
  });
});

describe('rango del período', () => {
  it('la semana va de lunes a domingo', () => {
    const rango = rangoDelPeriodo(crearPeriodo('semana', dia(17)));
    expect(rango.desde.getTime()).toBe(dia(14).getTime());
    expect(rango.hasta.getTime()).toBe(dia(20).getTime());
  });

  it('el día abre y cierra en la misma fecha', () => {
    const rango = rangoDelPeriodo(crearPeriodo('dia', dia(17)));
    expect(rango.desde.getTime()).toBe(rango.hasta.getTime());
  });

  it('el mes cubre el mes completo del ancla', () => {
    const rango = rangoDelPeriodo(crearPeriodo('mes', dia(17)));
    expect(rango.desde.getTime()).toBe(dia(1).getTime());
    expect(rango.hasta.getTime()).toBe(dia(30).getTime());
  });

  it('incluye ambos extremos y deja afuera las filas sin fecha', () => {
    const rango = rangoDelPeriodo(crearPeriodo('semana', dia(17)));
    expect(dentroDelPeriodo(dia(14), rango)).toBe(true);
    expect(dentroDelPeriodo(dia(20), rango)).toBe(true);
    expect(dentroDelPeriodo(dia(21), rango)).toBe(false);
    expect(dentroDelPeriodo(null, rango)).toBe(false);
  });
});

/** `YYYY-MM-DD` of each end: compared as text so a time-of-day slip cannot hide. */
function extremos(rango: { readonly desde: Date; readonly hasta: Date }): readonly string[] {
  return [rango.desde.toISOString(), rango.hasta.toISOString()];
}

describe('rango elegido en el calendario', () => {
  it('se devuelve tal cual, sin encajarlo en ninguna ventana', () => {
    expect(extremos(rangoDelPeriodo(crearRango(dia(10), dia(23))))).toEqual([
      '2026-09-10T00:00:00.000Z',
      '2026-09-23T00:00:00.000Z',
    ]);
  });

  it('invierte los extremos si llegan al revés y acepta un solo día', () => {
    expect(extremos(crearRango(dia(23), dia(10)))).toEqual(extremos(crearRango(dia(10), dia(23))));
    const unDia = crearRango(dia(17), dia(17));
    expect(unDia.desde.getTime()).toBe(unDia.hasta.getTime());
  });

  it('descarta la hora del día: los extremos quedan en medianoche UTC', () => {
    const r = crearRango(new Date('2026-09-10T22:30:00Z'), new Date('2026-09-12T01:00:00Z'));
    expect(extremos(r)).toEqual(['2026-09-10T00:00:00.000Z', '2026-09-12T00:00:00.000Z']);
  });

  it('incluye ambos extremos al filtrar', () => {
    const r = rangoDelPeriodo(crearRango(dia(10), dia(12)));
    expect(dentroDelPeriodo(dia(10), r)).toBe(true);
    expect(dentroDelPeriodo(dia(12), r)).toBe(true);
    expect(dentroDelPeriodo(dia(13), r)).toBe(false);
  });

  it('las flechas lo desplazan en bloques de su propio largo, sin repetir días', () => {
    const r = crearRango(dia(10), dia(16));
    expect(extremos(desplazarPeriodo(r, 1))).toEqual(extremos(crearRango(dia(17), dia(23))));
    expect(extremos(desplazarPeriodo(r, -1))).toEqual(extremos(crearRango(dia(3), dia(9))));
    expect(extremos(desplazarPeriodo(desplazarPeriodo(r, 1), -1))).toEqual(extremos(r));
  });

  it('un rango de un día avanza de a un día, cruzando el mes', () => {
    expect(extremos(desplazarPeriodo(crearRango(dia(30), dia(30)), 1))).toEqual([
      '2026-10-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
    ]);
  });

  it('cambiar a un preset lo ancla en la fecha desde', () => {
    const r = crearRango(dia(17), new Date(Date.UTC(2026, 9, 25)));
    expect(extremos(rangoDelPeriodo(cambiarModoPeriodo(r, 'mes')))).toEqual(
      extremos(rangoDelPeriodo(crearPeriodo('mes', dia(17)))),
    );
    expect(cambiarModoPeriodo(r, 'semana').ancla.getTime()).toBe(dia(14).getTime());
    expect(cambiarModoPeriodo(r, 'dia').ancla.getTime()).toBe(dia(17).getTime());
  });

  it('la etiqueta deletrea ambos extremos, o uno solo si es un día', () => {
    expect(etiquetaPeriodo(crearRango(dia(10), dia(23)))).toBe('10/09/2026 – 23/09/2026');
    expect(etiquetaPeriodo(crearRango(dia(17), dia(17)))).toBe('17/09/2026');
    expect(etiquetaPeriodo(crearPeriodo('semana', dia(17)))).toBe('14 sep 2026');
  });
});

describe('semanas parciales de un período', () => {
  it('una semana o un rango de lunes a domingo no las tiene', () => {
    expect(semanasParciales(crearPeriodo('semana', dia(17)))).toBeNull();
    expect(semanasParciales(crearRango(dia(14), dia(27)))).toBeNull();
  });

  it('un mes que no empieza en lunes las tiene, igual que un rango elegido a mano', () => {
    // September 2026 runs from a Tuesday to a Wednesday.
    expect(semanasParciales(crearPeriodo('mes', dia(17)))).toEqual({ primera: true, ultima: true, unica: false });
  });

  it('un día suelto es una sola semana incompleta', () => {
    expect(semanasParciales(crearPeriodo('dia', dia(17)))).toEqual({ primera: true, ultima: true, unica: true });
  });

  it('marca cada extremo que corta una semana', () => {
    expect(semanasParciales(crearRango(dia(16), dia(27)))).toEqual({ primera: true, ultima: false, unica: false });
    expect(semanasParciales(crearRango(dia(14), dia(24)))).toEqual({ primera: false, ultima: true, unica: false });
    expect(semanasParciales(crearRango(dia(15), dia(17)))).toEqual({ primera: true, ultima: true, unica: true });
  });

  it('un domingo que cierra el rango cierra su semana, no abre la siguiente', () => {
    // `getUTCDay()` of a Sunday is 0: the same trap as the anchor.
    expect(semanasParciales(crearRango(dia(15), dia(20)))).toEqual({ primera: true, ultima: false, unica: true });
  });
});

describe('hoy en Argentina', () => {
  const TZ_ORIGINAL = process.env.TZ;
  afterEach(() => {
    vi.useRealTimers();
    if (TZ_ORIGINAL === undefined) delete process.env.TZ;
    else process.env.TZ = TZ_ORIGINAL;
  });

  it('a las 22:30 del 17/09 en UTC-3 sigue siendo el 17, aunque en UTC ya sea el 18', () => {
    process.env.TZ = 'America/Argentina/Buenos_Aires';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T01:30:00Z'));
    expect(hoyUTC().toISOString()).toBe('2026-09-17T00:00:00.000Z');
  });
});
