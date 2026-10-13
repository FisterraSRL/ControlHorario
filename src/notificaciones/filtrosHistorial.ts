import { fechaValida, type DocumentoEmitido } from './envios.js';

export interface FiltrosHistorial {
  readonly busqueda?: string;
  readonly sector?: string;
  readonly desde?: string;
  readonly hasta?: string;
  readonly marcas?: 'con' | 'sin';
}
export function problemaFiltros(f: FiltrosHistorial): string | null {
  if ((f.busqueda?.length ?? 0) > 300 || (f.sector?.length ?? 0) > 300) return 'La búsqueda y el sector admiten hasta 300 caracteres.';
  if ((f.desde && !fechaValida(f.desde)) || (f.hasta && !fechaValida(f.hasta))) return 'Ingresá fechas válidas para el documento.';
  if (f.desde && f.hasta && f.desde > f.hasta) return 'La fecha desde no puede ser posterior a la fecha hasta.';
  if (f.marcas !== undefined && f.marcas !== 'con' && f.marcas !== 'sin') return 'El filtro de marcas no es válido.';
  return null;
}
export function normalizarFiltros(f: FiltrosHistorial): FiltrosHistorial {
  return { ...(f.busqueda?.trim() ? { busqueda: f.busqueda.trim() } : {}), ...(f.sector?.trim() ? { sector: f.sector.trim() } : {}), ...(f.desde ? { desde: f.desde } : {}), ...(f.hasta ? { hasta: f.hasta } : {}), ...(f.marcas ? { marcas: f.marcas } : {}) };
}
/** Literal, case-insensitive substrings; dates refer to the original document. */
export function coincideDocumento(d: DocumentoEmitido, filtros: FiltrosHistorial): boolean {
  const f = normalizarFiltros(filtros);
  const incluye = (texto: string, buscado: string) => texto.toLocaleLowerCase('es-AR').includes(buscado.toLocaleLowerCase('es-AR'));
  return (!f.busqueda || incluye(d.snapshot.usuario, f.busqueda) || incluye(d.snapshot.dni, f.busqueda)) &&
    (!f.sector || incluye(d.snapshot.sector, f.sector)) && (!f.desde || d.fechaDocumento >= f.desde) && (!f.hasta || d.fechaDocumento <= f.hasta) &&
    (!f.marcas || (f.marcas === 'con' ? d.activas.length > 0 : d.activas.length === 0));
}
