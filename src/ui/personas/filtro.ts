import { useMemo, useState } from 'react';

export interface PersonaFiltrable { readonly dni: string; readonly usuario: string; readonly sector: string }
export interface FiltroPersonas { readonly busqueda: string; readonly sector: string }
export const FILTRO_PERSONAS_INICIAL: FiltroPersonas = { busqueda: '', sector: '' };

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
}

export function filtrarPersonas<T extends PersonaFiltrable>(personas: readonly T[], filtro: FiltroPersonas): readonly T[] {
  const busqueda = normalizar(filtro.busqueda);
  const dni = /^[\d.\s-]+$/.test(busqueda) ? busqueda.replace(/\D/g, '') : '';
  return personas.filter(p => (!filtro.sector || JSON.stringify(p.sector) === filtro.sector)
    && (!busqueda || normalizar(p.usuario).includes(busqueda) || (dni !== '' && p.dni.replace(/\D/g, '').includes(dni))));
}

export function sectoresDelPeriodo(personas: readonly PersonaFiltrable[]) {
  return [...new Set(personas.map(p => p.sector))].sort((a, b) => a.localeCompare(b, 'es'))
    .map(sector => ({ valor: JSON.stringify(sector), label: sector || 'Sin sector' }));
}

export function useFiltroPersonas<T extends PersonaFiltrable>(todas: readonly T[]) {
  const [filtro, setFiltro] = useState(FILTRO_PERSONAS_INICIAL);
  const personas = useMemo(() => filtrarPersonas(todas, filtro), [todas, filtro]);
  const sectores = useMemo(() => sectoresDelPeriodo(todas), [todas]);
  return { personas, filtro, setFiltro, sectores,
    total: new Set(todas.map(p => p.dni)).size,
    cantidad: new Set(personas.map(p => p.dni)).size,
    sinCoincidencias: todas.length > 0 && personas.length === 0 };
}
