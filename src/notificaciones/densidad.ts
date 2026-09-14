/**
 * The one-page density.
 *
 * Font size, spacing and table row padding all scale down together as a person's fault
 * count grows, so the letter reliably stays on ONE page whether they have a single fault
 * or two weeks' worth of them.
 *
 * Legacy: `CUR_DENSITY`, `pickDensity` and `sp` (legacy/app.html ~lines 1891-1900). There
 * `CUR_DENSITY` was a mutable module global that `buildPersonaXml` reassigned before each
 * letter and every builder read behind the caller's back. Here the chosen density is an
 * explicit argument, which is the whole difference between the two versions: the output is
 * identical, but nothing depends on call order any more.
 */

import type { Densidad } from './tipos.js';

/** Up to 6 faults: comfortable. Also the legacy's initial `CUR_DENSITY` value. */
export const DENSIDAD_COMODA: Densidad = {
  body: 20,
  heading: 26,
  sub: 23,
  table: 19,
  spacingScale: 1,
  cellPadV: 50,
};

/** 7 to 14 faults. */
export const DENSIDAD_MEDIA: Densidad = {
  body: 18,
  heading: 23,
  sub: 20,
  table: 17,
  spacingScale: 0.62,
  cellPadV: 20,
};

/** 15 to 30 faults. */
export const DENSIDAD_APRETADA: Densidad = {
  body: 16,
  heading: 21,
  sub: 18,
  table: 14,
  spacingScale: 0.4,
  cellPadV: 8,
};

/** More than 30 faults. The tightest tier there is; it does not shrink further. */
export const DENSIDAD_MINIMA: Densidad = {
  body: 15,
  heading: 19,
  sub: 16,
  table: 12,
  spacingScale: 0.28,
  cellPadV: 4,
};

/**
 * The density a builder gets when nobody picked one. Same values the legacy's `CUR_DENSITY`
 * held before the first `buildPersonaXml` call reassigned it.
 */
export const DENSIDAD_POR_DEFECTO: Densidad = DENSIDAD_COMODA;

/**
 * Picks the tier for a person's total fault count.
 *
 * The thresholds are the legacy's and they are not round on purpose (6 / 14 / 30): they
 * were fitted to how much fits on an A4 page at each size. A count of exactly 6, 14 or 30
 * belongs to the roomier tier.
 *
 * A non-finite count (`NaN`) falls through every comparison and lands on the tightest tier,
 * which is the legacy behaviour and the safe direction to fail in — too small still prints.
 */
export function pickDensity(totalItems: number): Densidad {
  if (totalItems <= 6) return DENSIDAD_COMODA;
  if (totalItems <= 14) return DENSIDAD_MEDIA;
  if (totalItems <= 30) return DENSIDAD_APRETADA;
  return DENSIDAD_MINIMA;
}

/**
 * Scales a spacing constant (twips) by the density, with a floor of 20 twips so sections
 * never collapse into each other even at the tightest tier.
 */
export function sp(v: number, densidad: Densidad): number {
  return Math.max(20, Math.round(v * densidad.spacingScale));
}
