import type { TipoFalta } from './fichadas/tipos.js';

export const DIA_CORTE_PREDETERMINADO = 25;
export const MAX_NOTA_IRREGULARIDAD = 500;
export const ESTADOS_IRREGULARIDAD = ['justificada', 'revisada'] as const;
export type EstadoIrregularidad = (typeof ESTADOS_IRREGULARIDAD)[number];

export interface ClaveIrregularidad {
  readonly dni: string;
  readonly fecha: string;
  readonly tipo: TipoFalta;
}

export interface DecisionIrregularidad {
  readonly estado: EstadoIrregularidad;
  readonly nota: string;
}

export type RevisionIrregularidad = ClaveIrregularidad & DecisionIrregularidad;

export function esDiaCorte(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 1 && valor <= 31;
}

export function claveIrregularidad({ dni, fecha, tipo }: ClaveIrregularidad): string {
  return JSON.stringify([dni, fecha, tipo]);
}
