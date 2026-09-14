/**
 * The absence-registry boundary.
 *
 * WHAT IS IN A REGISTRY ENTRY, AND WHAT IS NOT. An entry carries the DECISION and nothing
 * else: which day it is about, the motivo, who resolved it and when, and how many files are
 * filed against it. It does NOT carry the person's name, their sector, the turno or the
 * QUICKPASS note — those are derived from the evidence by the engine on every read, and
 * storing a copy here would be the same freeze-the-past mistake decisions 6 and 7 of the
 * README refuse. The screen joins the two by `${dni}|${fechaStr}`.
 *
 * `fecha` is `YYYY-MM-DD` because that is what a Postgres DATE is. `RegistroDia.fechaStr` is
 * the raw `DD/MM/YYYY` QUICKPASS cell. `claveRegistro` below is the one place the two are
 * bridged, so nothing else has to remember which side it is on.
 */

import type { OrigenMotivo } from '../../domain/fichadas/index.js';

export interface AusenciaRegistrada {
  readonly dni: string;
  /** `YYYY-MM-DD`. */
  readonly fecha: string;
  readonly motivoId: number | null;
  readonly motivoSource: OrigenMotivo | null;
  readonly resueltoPor: string | null;
  readonly resueltoAt: string | null;
  readonly adjuntos: number;
}

/** `${dni}|${YYYY-MM-DD}`. The key of the registry, and of nothing else. */
export type ClaveRegistro = string;

export function claveRegistro(dni: string, fechaIso: string): ClaveRegistro {
  return `${dni}|${fechaIso}`;
}

/**
 * `DD/MM/YYYY` -> `YYYY-MM-DD`, without building a Date.
 *
 * A `new Date('05/01/2026')` is parsed as American, and `new Date(2026, 0, 5)` is local
 * midnight, which west of Greenwich reads back as the 4th. `src/domain/fichadas/parseo.ts`
 * is careful about exactly this; a string swap avoids the question entirely.
 */
export function fechaIsoDesdeAR(fechaStr: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fechaStr.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** `YYYY-MM-DD` -> `DD/MM/YYYY`, for the row that has to be shown the way the sheet had it. */
export function fechaARDesdeIso(fechaIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaIso.trim());
  if (!m) return fechaIso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export interface RepositorioAusencias {
  /** The whole registry. Filtering by period and sector happens in the screen. */
  listar(): Promise<readonly AusenciaRegistrada[]>;
  /**
   * Sets or clears the motivo of one day. Always recorded as a manual RRHH decision.
   *
   * `fechaStr` is the raw `DD/MM/YYYY` cell, because that is what the screen has in hand
   * from `RegistroDia`.
   */
  asignarMotivo(
    dni: string,
    fechaStr: string,
    motivoId: number | null,
  ): Promise<AusenciaRegistrada>;
}
