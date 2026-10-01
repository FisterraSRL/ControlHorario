/**
 * The motivo dropdown, as data — shared by Ausencias and Horas trabajadas.
 *
 * Both screens write the same decision through the same `asignarMotivo`, so they must offer
 * the same choices in the same order and confirm a write with the same words. Two copies
 * would drift the first time somebody renamed "Sin clasificar" in one of them.
 *
 * Pure: no React, no repository.
 */

import type { Motivo } from '../../domain/fichadas/index.js';

export interface OpcionMotivo {
  readonly valor: string;
  readonly label: string;
}

/** `''` is "Sin clasificar": a native `<select>` cannot carry a null. */
export function opcionesMotivo(motivos: readonly Motivo[]): readonly OpcionMotivo[] {
  return [
    { valor: '', label: 'Sin clasificar' },
    ...motivos.map((m) => ({ valor: String(m.id), label: m.label })),
  ];
}

/** What the operator reads after ONE day's motivo was actually written. */
export function avisoMotivo(motivoId: number | null): string {
  return motivoId === null ? 'Se quitó la clasificación.' : 'Motivo asignado.';
}
