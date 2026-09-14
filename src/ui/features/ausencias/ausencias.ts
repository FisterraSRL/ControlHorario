/**
 * The Ausencias screen, as data.
 *
 * Pure functions: registry entries and day records in, sorted rows out. No React, no
 * repository, no fetch — same discipline as `features/carga/resumen.ts`, and the reason the
 * filtering and grouping rules can be read without opening a component.
 *
 * THE JOIN IS THE INTERESTING PART. A registry entry carries a decision and nothing else:
 * dni, fecha, motivo, who resolved it. The person's name, their sector, the turno and the
 * QUICKPASS note are NOT in it — they are derived from the evidence by the engine on every
 * read, which is what makes a rule fix retroactive (README, decisions 6 and 7). So the row
 * on screen is the two halves put together here, and an entry whose evidence is gone simply
 * has no row.
 */

import { fmtFechaAR, type RegistroDia } from '../../../domain/fichadas/index.js';
import type { Adjunto } from '../../adjuntos/RepositorioAdjuntos.js';
import {
  claveRegistro,
  fechaIsoDesdeAR,
  type AusenciaRegistrada,
  type ClaveRegistro,
} from '../../ausencias/RepositorioAusencias.js';
import { dentroDelPeriodo, type RangoPeriodo } from '../../periodo/periodo.js';

export interface FilaAusencia {
  readonly clave: ClaveRegistro;
  readonly dni: string;
  /** `YYYY-MM-DD`, the registry's own key. */
  readonly fechaIso: string;
  /** `DD/MM/YYYY`, the raw QUICKPASS cell — what the operator recognises. */
  readonly fechaStr: string;
  readonly fecha: Date | null;
  readonly usuario: string;
  readonly sector: string;
  readonly legajo: string;
  readonly turnoRaw: string;
  readonly partesRaw: string;
  readonly motivoId: number | null;
  readonly motivoSource: string | null;
  readonly resueltoPor: string | null;
  readonly adjuntos: readonly Adjunto[];
}

export interface FiltroAusencias {
  /** Empty means every sector. */
  readonly sector: string;
  /** A DNI. Empty means everybody. */
  readonly dni: string;
  /**
   * Checked by default, and that default is the whole point of the screen: it is a work
   * queue, and what an operator opens it to do is classify the days nobody has classified.
   */
  readonly soloPendientes: boolean;
}

export const FILTRO_INICIAL: FiltroAusencias = {
  sector: '',
  dni: '',
  soloPendientes: true,
};

export interface OpcionFiltro {
  readonly valor: string;
  readonly label: string;
}

export interface VistaAusencias {
  /** After the period and the sector/person filters, before "solo sin clasificar". */
  readonly enPeriodo: readonly FilaAusencia[];
  /** What the table renders. */
  readonly filas: readonly FilaAusencia[];
  readonly pendientes: number;
  readonly total: number;
  readonly sectores: readonly OpcionFiltro[];
  readonly personas: readonly OpcionFiltro[];
}

/** `${dni}|${YYYY-MM-DD}` for a day record, so it can be looked up against the registry. */
function claveDeRegistro(registro: RegistroDia): ClaveRegistro | null {
  const iso = fechaIsoDesdeAR(registro.fechaStr);
  return iso ? claveRegistro(registro.dni, iso) : null;
}

export interface DatosVista {
  readonly ausencias: readonly AusenciaRegistrada[];
  readonly registros: readonly RegistroDia[];
  readonly adjuntos: readonly Adjunto[];
  readonly rango: RangoPeriodo;
  readonly filtro: FiltroAusencias;
}

export function construirVista(datos: DatosVista): VistaAusencias {
  const porClave = new Map<ClaveRegistro, RegistroDia>();
  for (const registro of datos.registros) {
    const clave = claveDeRegistro(registro);
    if (clave) porClave.set(clave, registro);
  }

  const adjuntosPorClave = new Map<ClaveRegistro, Adjunto[]>();
  for (const adjunto of datos.adjuntos) {
    const clave = claveRegistro(adjunto.dni, adjunto.fecha);
    const lista = adjuntosPorClave.get(clave);
    if (lista) lista.push(adjunto);
    else adjuntosPorClave.set(clave, [adjunto]);
  }

  const todas: FilaAusencia[] = [];
  for (const ausencia of datos.ausencias) {
    const clave = claveRegistro(ausencia.dni, ausencia.fecha);
    const registro = porClave.get(clave);
    // No evidence, no row. The foreign key makes this impossible on the server; offline the
    // registry is derived from the historial, so it cannot happen there either. It is
    // handled rather than asserted because a row with no name and no date would be a row
    // nobody can act on.
    if (!registro) continue;
    todas.push({
      clave,
      dni: ausencia.dni,
      fechaIso: ausencia.fecha,
      fechaStr: registro.fechaStr,
      fecha: registro.fecha,
      usuario: registro.usuario,
      sector: registro.sector,
      legajo: registro.legajo,
      turnoRaw: registro.turnoRaw,
      partesRaw: registro.partesRaw,
      motivoId: ausencia.motivoId,
      motivoSource: ausencia.motivoSource,
      resueltoPor: ausencia.resueltoPor,
      adjuntos: adjuntosPorClave.get(clave) ?? [],
    });
  }

  /**
   * The filter options come from every row in the registry, NOT from the rows currently
   * shown: an option list that shrank as you filtered would make it impossible to switch
   * from one sector to another without clearing the first. Same behaviour as the legacy
   * `renderAusenciaFilterOptions`, which read the whole `ausenciasMap`.
   */
  const sectores = new Set<string>();
  const personas = new Map<string, string>();
  for (const fila of todas) {
    if (fila.sector) sectores.add(fila.sector);
    if (fila.dni) personas.set(fila.dni, fila.usuario || fila.dni);
  }

  const enPeriodo = todas.filter((fila) => {
    if (!dentroDelPeriodo(fila.fecha, datos.rango)) return false;
    if (datos.filtro.sector && fila.sector !== datos.filtro.sector) return false;
    if (datos.filtro.dni && fila.dni !== datos.filtro.dni) return false;
    return true;
  });

  const pendientes = enPeriodo.filter((fila) => fila.motivoId === null);
  const filas = (datos.filtro.soloPendientes ? pendientes : enPeriodo).slice().sort(comparar);

  return {
    enPeriodo,
    filas,
    pendientes: pendientes.length,
    total: enPeriodo.length,
    sectores: [...sectores]
      .sort((a, b) => a.localeCompare(b))
      .map((s) => ({ valor: s, label: s })),
    personas: [...personas.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([dni, nombre]) => ({ valor: dni, label: `${nombre} — ${dni}` })),
  };
}

/**
 * Sector, then person, then date — the legacy order, kept because the people who use this
 * every day read it by position.
 *
 * The date sorts on `fechaIso` rather than on the `DD/MM/YYYY` cell. The legacy file
 * reversed the string on `/` to get the same effect; here the ISO form is already at hand
 * and sorts correctly as text.
 */
function comparar(a: FilaAusencia, b: FilaAusencia): number {
  return (
    a.sector.localeCompare(b.sector) ||
    a.usuario.localeCompare(b.usuario) ||
    a.fechaIso.localeCompare(b.fechaIso)
  );
}

/** `1,2 MB`. Spanish decimal comma, because the rest of the screen uses one. */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** `05/01/2026`, from a row that always has the raw cell and may not have a Date. */
export function etiquetaFecha(fila: FilaAusencia): string {
  return fila.fecha ? fmtFechaAR(fila.fecha) : fila.fechaStr;
}
