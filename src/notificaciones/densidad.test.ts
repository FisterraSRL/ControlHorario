import { describe, expect, it } from 'vitest';

import {
  DENSIDAD_APRETADA,
  DENSIDAD_COMODA,
  DENSIDAD_MEDIA,
  DENSIDAD_MINIMA,
  DENSIDAD_POR_DEFECTO,
  pickDensity,
  sp,
} from './densidad.js';

describe('pickDensity', () => {
  // The thresholds are the legacy's and they are not round numbers. Asserting the exact
  // boundary on both sides is the only way to know a refactor kept them.
  it('uses the comfortable tier up to and including 6 items', () => {
    expect(pickDensity(0)).toBe(DENSIDAD_COMODA);
    expect(pickDensity(1)).toBe(DENSIDAD_COMODA);
    expect(pickDensity(5)).toBe(DENSIDAD_COMODA);
    expect(pickDensity(6)).toBe(DENSIDAD_COMODA);
  });

  it('switches to the medium tier at 7 and holds it through 14', () => {
    expect(pickDensity(7)).toBe(DENSIDAD_MEDIA);
    expect(pickDensity(14)).toBe(DENSIDAD_MEDIA);
  });

  it('switches to the tight tier at 15 and holds it through 30', () => {
    expect(pickDensity(15)).toBe(DENSIDAD_APRETADA);
    expect(pickDensity(30)).toBe(DENSIDAD_APRETADA);
  });

  it('switches to the tightest tier at 31 and never goes below it', () => {
    expect(pickDensity(31)).toBe(DENSIDAD_MINIMA);
    expect(pickDensity(200)).toBe(DENSIDAD_MINIMA);
    expect(pickDensity(Number.MAX_SAFE_INTEGER)).toBe(DENSIDAD_MINIMA);
    expect(pickDensity(Infinity)).toBe(DENSIDAD_MINIMA);
  });

  it('treats a negative count as the comfortable tier, as the legacy comparison did', () => {
    expect(pickDensity(-1)).toBe(DENSIDAD_COMODA);
  });

  it('falls to the tightest tier on NaN, which fails small rather than off the page', () => {
    // Every `<=` comparison against NaN is false, so it falls through to the last return.
    expect(pickDensity(NaN)).toBe(DENSIDAD_MINIMA);
  });

  it('shrinks every dimension monotonically as the tiers tighten', () => {
    const tiers = [DENSIDAD_COMODA, DENSIDAD_MEDIA, DENSIDAD_APRETADA, DENSIDAD_MINIMA];
    for (const clave of ['body', 'heading', 'sub', 'table', 'spacingScale', 'cellPadV'] as const) {
      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i]?.[clave]).toBeLessThan(tiers[i - 1]?.[clave] ?? 0);
      }
    }
  });

  it('exposes the comfortable tier as the default, matching the legacy initial value', () => {
    expect(DENSIDAD_POR_DEFECTO).toEqual({
      body: 20,
      heading: 26,
      sub: 23,
      table: 19,
      spacingScale: 1,
      cellPadV: 50,
    });
  });
});

describe('sp', () => {
  it('passes a value straight through at full scale', () => {
    expect(sp(160, DENSIDAD_COMODA)).toBe(160);
    expect(sp(120, DENSIDAD_COMODA)).toBe(120);
  });

  it('scales and rounds at the tighter tiers', () => {
    expect(sp(160, DENSIDAD_MEDIA)).toBe(Math.round(160 * 0.62)); // 99
    expect(sp(160, DENSIDAD_MEDIA)).toBe(99);
    expect(sp(140, DENSIDAD_APRETADA)).toBe(56);
    expect(sp(260, DENSIDAD_MINIMA)).toBe(73);
  });

  it('never returns less than 20 twips, so sections cannot collapse together', () => {
    expect(sp(60, DENSIDAD_MINIMA)).toBe(20); // 60 * 0.28 = 16.8 -> floored at 20
    expect(sp(0, DENSIDAD_COMODA)).toBe(20);
    expect(sp(1, DENSIDAD_MINIMA)).toBe(20);
    expect(sp(-500, DENSIDAD_COMODA)).toBe(20);
  });

  it('rounds half away from zero, the way Math.round does', () => {
    expect(sp(100, { ...DENSIDAD_COMODA, spacingScale: 0.505 })).toBe(51);
    expect(sp(100, { ...DENSIDAD_COMODA, spacingScale: 0.504 })).toBe(50);
  });
});
