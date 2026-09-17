import { describe, expect, it } from 'vitest';

import {
  crearPeriodo,
  dentroDelPeriodo,
  desplazarPeriodo,
  etiquetaAncla,
  periodoInicial,
  rangoDelPeriodo,
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
