import {
  ESTADOS_IRREGULARIDAD, type ClaveIrregularidad,
  type DecisionIrregularidad, type RevisionIrregularidad,
} from '../../domain/cierre.js';

const TIPOS: ReadonlySet<unknown> = new Set(['incompleta', 'descanso', 'tardanza']);
const ESTADOS: ReadonlySet<unknown> = new Set(ESTADOS_IRREGULARIDAD);

export function esRevision(valor: unknown): valor is RevisionIrregularidad {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return false;
  const revision = valor as Record<string, unknown>;
  return typeof revision['dni'] === 'string' && typeof revision['fecha'] === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(revision['fecha']) &&
    TIPOS.has(revision['tipo']) && ESTADOS.has(revision['estado']) && typeof revision['nota'] === 'string';
}

export interface RepositorioCierre {
  leerCorte(): Promise<number>;
  guardarCorte(dia: number): Promise<void>;
  listar(desde: string, hasta: string): Promise<readonly RevisionIrregularidad[]>;
  decidir(clave: ClaveIrregularidad, decision: DecisionIrregularidad | null): Promise<void>;
}
