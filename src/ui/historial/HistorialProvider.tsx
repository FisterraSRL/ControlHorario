/**
 * Container for the accumulated historial.
 *
 * It owns the one call into the repository port and the one call into the domain engine,
 * and hands both results down as plain data. Nothing below it imports `src/domain` or
 * touches storage.
 *
 * `registros` is derived from the FULL historial, not from the file uploaded this session —
 * that is what lets a period filter reach back into an upload whose Excel is long gone.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  construirRegistroDia,
  type FilaQuickpass,
  type RegistroDia,
} from '../../domain/fichadas/index.js';
import { configuracionPorDefecto } from '../features/configuracion/configuracion.js';
import { crearRepositorio } from './crearRepositorio.js';
import type { RepositorioFichadas, ResultadoGuardado } from './RepositorioFichadas.js';

interface ContextoHistorial {
  /** Raw QUICKPASS rows, as stored. */
  readonly filas: readonly FilaQuickpass[];
  /** The same rows run through the rules engine. Recomputed on every change. */
  readonly registros: readonly RegistroDia[];
  readonly sectores: readonly string[];
  readonly cargando: boolean;
  /** A repository failure. Rendered by whoever is on screen; never only logged. */
  readonly error: string | null;
  readonly guardar: (filas: readonly FilaQuickpass[]) => Promise<ResultadoGuardado>;
}

const HistorialContext = createContext<ContextoHistorial | null>(null);

function mensajeDeError(e: unknown): string {
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado con el historial.';
}

export function HistorialProvider({
  children,
  repositorio,
}: {
  readonly children: ReactNode;
  /** Injected in full: the provider never reaches for a concrete adapter of its own. */
  readonly repositorio?: RepositorioFichadas;
}) {
  // `crearRepositorio` reads VITE_API_BASE_URL and returns the Postgres-backed HTTP adapter
  // or the localStorage one. Injecting `repositorio` still overrides both — that is how a
  // test or a story hands in a fake.
  const [repo] = useState<RepositorioFichadas>(() => repositorio ?? crearRepositorio());
  const [filas, setFilas] = useState<readonly FilaQuickpass[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    repo
      .listar()
      .then((almacenadas) => {
        if (vigente) setFilas(almacenadas);
      })
      .catch((e: unknown) => {
        if (vigente) setError(mensajeDeError(e));
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [repo]);

  const guardar = useCallback(
    async (nuevas: readonly FilaQuickpass[]) => {
      setError(null);
      const resultado = await repo.upsert(nuevas);
      setFilas(await repo.listar());
      return resultado;
    },
    [repo],
  );

  const cfg = useMemo(configuracionPorDefecto, []);

  const registros = useMemo(
    () => filas.map((fila) => construirRegistroDia(fila, cfg)),
    [filas, cfg],
  );

  const sectores = useMemo(() => {
    const vistos = new Set<string>();
    for (const r of registros) if (r.sector) vistos.add(r.sector);
    return [...vistos].sort((a, b) => a.localeCompare(b));
  }, [registros]);

  const valor = useMemo<ContextoHistorial>(
    () => ({ filas, registros, sectores, cargando, error, guardar }),
    [filas, registros, sectores, cargando, error, guardar],
  );

  return <HistorialContext.Provider value={valor}>{children}</HistorialContext.Provider>;
}

export function useHistorial(): ContextoHistorial {
  const ctx = useContext(HistorialContext);
  if (!ctx) throw new Error('useHistorial se usó fuera de <HistorialProvider>.');
  return ctx;
}
