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

/**
 * The registry after a batch write: every returned row replaces the one with its key, and a
 * key the registry did not have yet is appended. Order is otherwise preserved.
 *
 * Pure so the provider can apply a whole batch in ONE `setAusencias` — N single-row updates
 * would re-derive every day record N times — and so the rule can be tested without React.
 */
export function reemplazarAusencias(
  previas: readonly AusenciaRegistrada[],
  actualizadas: readonly AusenciaRegistrada[],
): readonly AusenciaRegistrada[] {
  if (actualizadas.length === 0) return previas;
  const nuevas = new Map<ClaveRegistro, AusenciaRegistrada>();
  for (const a of actualizadas) nuevas.set(claveRegistro(a.dni, a.fecha), a);
  const salida = previas.map((a) => {
    const clave = claveRegistro(a.dni, a.fecha);
    const nueva = nuevas.get(clave);
    if (!nueva) return a;
    nuevas.delete(clave);
    return nueva;
  });
  return [...salida, ...nuevas.values()];
}

/** One day of a batch classification, as the screen has it in hand. */
export interface DiaAClasificar {
  readonly dni: string;
  /** The raw `DD/MM/YYYY` cell, exactly as `asignarMotivo` takes it. */
  readonly fechaStr: string;
}

/**
 * The most days one `asignarMotivos` call may carry. It mirrors `MAX_DIAS_POR_LOTE` in
 * `src/api/esquemas.ts`, which refuses anything larger; the screen checks it first so the
 * operator reads why instead of a schema error.
 */
export const MAX_DIAS_POR_LOTE = 500;

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
  /**
   * Sets or clears the motivo of many days in one decision, all or nothing.
   *
   * The same decision as `asignarMotivo` applied to each day. Either every day is written or
   * none is — the server refuses the whole batch if any day is out of the caller's scope —
   * and the answer is the rows as they now stand, so the caller can replace them in place.
   */
  asignarMotivos(
    dias: readonly DiaAClasificar[],
    motivoId: number | null,
  ): Promise<readonly AusenciaRegistrada[]>;
}
