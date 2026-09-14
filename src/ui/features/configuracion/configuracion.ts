/**
 * The Configuración screen, as data. Pure: no React, no repository.
 *
 * Two joins happen here, and both go the same way: the configuration stores an identifier,
 * and the label beside it on screen comes from the evidence.
 *
 *   * a sector rule is keyed by the free-text `Sector` column of the QUICKPASS export, and
 *     the list shown is the UNION of the sectors seen in the historial and the sectors that
 *     already have a rule — the legacy `renderConfigSectores` did exactly this, so a rule
 *     for a sector that stopped appearing in the export is still visible and removable;
 *
 *   * an exclusion is keyed by DNI and NEVER carries a name. The name shown next to it is
 *     looked up in the historial. That is not a normalisation nicety: `exclusiones` exists
 *     because the implementation being replaced hardcoded six real employees by name, and a
 *     table that carried the names would be the same mistake with extra steps.
 */

import type { RegistroDia } from '../../../domain/fichadas/index.js';
import type { Exclusion } from '../../configuracion/RepositorioConfiguracion.js';

/** Fichadas required when a sector has no rule. The engine's own default. */
export const FICHADAS_POR_DEFECTO = 4;

export interface FilaSector {
  readonly sector: string;
  readonly fichadasRequeridas: number;
  /** `false` when no row of the historial mentions it any more. */
  readonly enElHistorial: boolean;
}

export interface FilaExclusion {
  readonly dni: string;
  /** The person's name, from the evidence. Falls back to the DNI when nobody matches. */
  readonly nombre: string;
  readonly motivoTexto: string | null;
  readonly creadoPor: string | null;
}

export interface OpcionPersona {
  readonly valor: string;
  readonly label: string;
}

/** DNI -> name, from the accumulated historial. */
export function personasDelHistorial(
  registros: readonly RegistroDia[],
): ReadonlyMap<string, string> {
  const personas = new Map<string, string>();
  for (const r of registros) {
    if (!r.dni) continue;
    // Last one wins: a name is respelled between exports (accents come and go) and the most
    // recent spelling is the one the operator saw most recently.
    personas.set(r.dni, r.usuario || r.dni);
  }
  return personas;
}

export function filasDeSector(
  reglas: Readonly<Record<string, number>>,
  sectoresDelHistorial: readonly string[],
): readonly FilaSector[] {
  const vistos = new Set(sectoresDelHistorial.filter((s) => s !== ''));
  const todos = new Set<string>([...vistos, ...Object.keys(reglas)]);
  return [...todos]
    .sort((a, b) => a.localeCompare(b))
    .map((sector) => ({
      sector,
      fichadasRequeridas: reglas[sector] ?? FICHADAS_POR_DEFECTO,
      enElHistorial: vistos.has(sector),
    }));
}

export function filasDeExclusion(
  exclusiones: readonly Exclusion[],
  personas: ReadonlyMap<string, string>,
): readonly FilaExclusion[] {
  return exclusiones
    .map((e) => ({
      dni: e.dni,
      nombre: personas.get(e.dni) ?? e.dni,
      motivoTexto: e.motivoTexto,
      creadoPor: e.creadoPor,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Everybody in the historial who is not already excluded, for the "add" dropdown. */
export function personasExcluibles(
  personas: ReadonlyMap<string, string>,
  exclusiones: readonly Exclusion[],
): readonly OpcionPersona[] {
  const yaExcluidos = new Set(exclusiones.map((e) => e.dni));
  return [...personas.entries()]
    .filter(([dni]) => !yaExcluidos.has(dni))
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([dni, nombre]) => ({ valor: dni, label: `${nombre} — ${dni}` }));
}

/**
 * A parameter typed into a text field, or `null` when it is not a number this app accepts.
 *
 * The legacy handlers were `parseFloat(e.target.value) || 51`, which silently turned an
 * empty field into the default and a typo into a different number. Here a bad value is
 * refused and the field says so, because these three numbers decide who gets a letter.
 */
export function parametroValido(crudo: string, maximo: number): number | null {
  const limpio = crudo.trim().replace(',', '.');
  if (limpio === '') return null;
  const n = Number(limpio);
  if (!Number.isFinite(n) || n < 0 || n > maximo) return null;
  return n;
}
