/** Versioned, immutable letter snapshots shared by both persistence adapters. */
import type { ItemsPorTipo, NotificacionPersona } from './tipos.js';
import { clavesNotificadas, type ClaveNotificada } from '../ui/faltas/porDia.js';

export type SnapshotPersona = Omit<NotificacionPersona, 'faltasPorTipo'> & {
  readonly faltasPorTipo: { readonly [K in keyof ItemsPorTipo]: readonly (Omit<ItemsPorTipo[K], 'fechaOrden'> & { readonly fechaOrden: string })[] };
};
export interface DocumentoPendiente {
  readonly id: string;
  readonly creadoAt: string;
  readonly snapshot: SnapshotPersona;
}
export interface MarcaVersionada extends ClaveNotificada {
  readonly version: string;
  readonly notificadoAt: string;
}
export interface DocumentoEmitido extends DocumentoPendiente {
  readonly emisionId: string;
  readonly emitidoAt: string;
  readonly fechaDocumento: string;
  readonly activas: readonly MarcaVersionada[];
}
export interface HistorialEnvios {
  readonly documentos: readonly DocumentoEmitido[];
  readonly anteriores: readonly MarcaVersionada[];
  readonly hayMas: boolean;
}
export interface PedidoEmision {
  readonly id: string;
  readonly documentos: readonly string[];
  readonly fechaDocumento: string;
}
export interface RepositorioEnvios {
  pendientes(): Promise<readonly DocumentoPendiente[]>;
  encolar(documentos: readonly { readonly id: string; readonly snapshot: SnapshotPersona }[]): Promise<void>;
  descartar(id: string): Promise<void>;
  emitir(pedido: PedidoEmision): Promise<readonly DocumentoEmitido[]>;
  historial(pagina: number): Promise<HistorialEnvios>;
  quitar(marcas: readonly MarcaVersionada[]): Promise<void>;
}
export class ConflictoEnvio extends Error {}
export const MAX_DOCUMENTOS = 200;
export const MAX_FILAS_DOCUMENTO = 500;
export const MAX_FALTAS_COLA = 5000;
export const TAMANO_HISTORIAL = 50;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fechaValida(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return Number.isFinite(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}
function objeto(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
function campos(v: Record<string, unknown>, permitidos: readonly string[]) { return Object.keys(v).every(k => permitidos.includes(k)); }
function texto(v: unknown, max = 500): v is string { return typeof v === 'string' && v.length <= max; }

/** Reject unknown fields, invalid calendar dates, duplicate keys and oversized snapshots. */
export function esSnapshot(v: unknown): v is SnapshotPersona {
  if (!objeto(v) || !campos(v, ['usuario', 'dni', 'sector', 'legajo', 'faltasPorTipo']) ||
    !texto(v['usuario'], 300) || !texto(v['sector'], 300) || !texto(v['dni'], 32) || !v['dni'] || v['dni'].includes('|') ||
    (v['legajo'] !== undefined && !texto(v['legajo'], 100)) || !objeto(v['faltasPorTipo'])) return false;
  const buckets = v['faltasPorTipo'];
  if (!campos(buckets, ['incompleta', 'descanso', 'tardanza'])) return false;
  let total = 0;
  for (const tipo of ['incompleta', 'descanso', 'tardanza'] as const) {
    const filas = buckets[tipo];
    if (!Array.isArray(filas)) return false;
    const extras = tipo === 'incompleta' ? ['registradas', 'cantidad'] : tipo === 'descanso' ? ['descansoTomado', 'exceso'] : ['horarioFichado', 'minutos'];
    const vistas = new Set<string>();
    for (const f of filas) {
      if (!objeto(f) || !campos(f, ['fecha', 'turnoRaw', 'fechaOrden', 'detalle', ...extras]) ||
        !texto(f['fecha'], 32) || !texto(f['turnoRaw']) || !fechaValida(f['fechaOrden']) ||
        (f['detalle'] !== undefined && !texto(f['detalle'])) || !extras.every(k => texto(f[k])) || vistas.has(f['fechaOrden'])) return false;
      vistas.add(f['fechaOrden']);
      if (++total > MAX_FILAS_DOCUMENTO) return false;
    }
  }
  return total > 0;
}
export function snapshotDe(persona: NotificacionPersona): SnapshotPersona {
  const convertir = <T extends { readonly fechaOrden: Date | null }>(f: T) => {
    if (!f.fechaOrden) throw new Error('No se puede preparar una falta sin fecha válida.');
    return { ...f, fechaOrden: f.fechaOrden.toISOString().slice(0, 10) };
  };
  const snapshot = { usuario: persona.usuario, dni: persona.dni, sector: persona.sector,
    ...(persona.legajo === undefined ? {} : { legajo: persona.legajo }), faltasPorTipo: {
    incompleta: persona.faltasPorTipo.incompleta.map(convertir),
    descanso: persona.faltasPorTipo.descanso.map(convertir),
    tardanza: persona.faltasPorTipo.tardanza.map(convertir),
  } };
  if (!esSnapshot(snapshot)) throw new Error('La selección no admite un documento válido (máximo 500 faltas por persona).');
  return snapshot;
}
export function personaDe(snapshot: SnapshotPersona): NotificacionPersona {
  const convertir = <T extends { readonly fechaOrden: string }>(f: T) => ({ ...f, fechaOrden: new Date(`${f.fechaOrden}T00:00:00.000Z`) });
  return { ...snapshot, faltasPorTipo: {
    incompleta: snapshot.faltasPorTipo.incompleta.map(convertir),
    descanso: snapshot.faltasPorTipo.descanso.map(convertir),
    tardanza: snapshot.faltasPorTipo.tardanza.map(convertir),
  } };
}
export function clavesSnapshot(snapshot: SnapshotPersona): readonly ClaveNotificada[] { return clavesNotificadas(personaDe(snapshot)); }
export function idMarca(c: ClaveNotificada): string { return `${c.dni}|${c.fechaIso}|${c.tipo}`; }
export function comprobarCola(actuales: readonly DocumentoPendiente[], nuevos: readonly { readonly id: string; readonly snapshot: SnapshotPersona }[]): void {
  const ids = new Map(actuales.map(d => [d.id, d]));
  const claves = new Set(actuales.flatMap(d => clavesSnapshot(d.snapshot).map(idMarca)));
  let total = actuales.length;
  for (const d of nuevos) {
    const existente = ids.get(d.id);
    if (existente) {
      if (JSON.stringify(existente.snapshot) !== JSON.stringify(d.snapshot)) throw new ConflictoEnvio('La preparación ya existe con otro contenido.');
      continue;
    }
    if (++total > MAX_DOCUMENTOS) throw new ConflictoEnvio('El panel admite hasta 200 documentos. Generá o descartá los pendientes antes de agregar más.');
    for (const c of clavesSnapshot(d.snapshot)) {
      if (claves.has(idMarca(c))) throw new ConflictoEnvio('Una de las faltas ya está en el panel de envío. Revisá los pendientes antes de agregarla otra vez.');
      claves.add(idMarca(c));
      if (claves.size > MAX_FALTAS_COLA) throw new ConflictoEnvio('El panel admite hasta 5000 faltas. Generá o descartá los pendientes antes de agregar más.');
    }
    ids.set(d.id, { ...d, creadoAt: '' });
  }
}
