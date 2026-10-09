/**
 * Container for the accumulated historial.
 *
 * It owns the one call into the repository port and the one call into the domain engine,
 * and hands both results down as plain data. Nothing below it imports `src/domain` or
 * touches storage.
 *
 * `registros` is derived from the FULL historial, not from the file uploaded this session —
 * that is what lets a period filter reach back into an upload whose Excel is long gone.
 *
 * IT DERIVES WITH THE REAL CONFIGURATION AND THE REAL DECISIONS. Until slice 2b both were
 * constants: a hardcoded `configuracionPorDefecto()` and no absences at all, so every
 * absence read as "sin clasificar" and every threshold was the default. Both now come from
 * the two providers above this one, which is why they are above it: the engine needs them
 * to produce a `RegistroDia`, and a screen that rendered before they arrived would show
 * numbers it would then silently correct.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  construirRegistroDia,
  perdonarTardanzas,
  TARDANZAS_PERDONADAS_POR_DEFECTO,
  type FilaQuickpass,
  type RegistroDia,
} from '../../domain/fichadas/index.js';
import { useAusencias } from '../ausencias/AusenciasProvider.js';
import { useConfiguracion } from '../configuracion/ConfiguracionProvider.js';
import { ErrorNoAutenticado } from '../http.js';
import { useSesion } from '../sesion/SesionProvider.js';
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
  readonly recargar: () => void;
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
  const { repositorios, expirar } = useSesion();
  const { paraElMotor, cargando: cargandoConfiguracion } = useConfiguracion();
  const { indiceParaElMotor, recargar: recargarAusencias } = useAusencias();

  const [repo] = useState<RepositorioFichadas>(() => repositorio ?? repositorios.fichadas);
  const [filas, setFilas] = useState<readonly FilaQuickpass[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [revision, setRevision] = useState(0);
  const recargar = useCallback(() => {
    setCargando(true);
    setError(null);
    setRevision(v => v + 1);
  }, []);

  useEffect(() => {
    let vigente = true;
    repo
      .listar()
      .then((almacenadas) => {
        if (vigente) setFilas(almacenadas);
      })
      .catch((e: unknown) => {
        if (!vigente) return;
        if (e instanceof ErrorNoAutenticado) {
          expirar();
          return;
        }
        setError(mensajeDeError(e));
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [repo, expirar, revision]);

  const guardar = useCallback(
    async (nuevas: readonly FilaQuickpass[]) => {
      setError(null);
      setCargando(true);
      try {
        const resultado = await repo.upsert(nuevas);
        setFilas(await repo.listar());
        /**
         * The upload re-derived the absence registry on the server — `sincronizar` in
         * `src/api/rutas.ts`, the port of the legacy `recompute()`. Without this the Ausencias
         * screen and the sidebar count would keep showing the registry as it was before the
         * spreadsheet that just changed it.
         */
        await recargarAusencias();
        return resultado;
      } catch (e: unknown) {
        if (e instanceof ErrorNoAutenticado) expirar();
        else setError(mensajeDeError(e));
        throw e;
      } finally {
        setCargando(false);
      }
    },
    [repo, recargarAusencias, expirar],
  );

  const cfg = useMemo(
    () => ({ ...paraElMotor, ausencias: indiceParaElMotor }),
    [paraElMotor, indiceParaElMotor],
  );

  /**
   * The weekly tardanza allowance is applied HERE, once, over every row — never per screen
   * and never over a period. Every consumer below reads `registros`, so the Indicador, the
   * Word, Horas and the sidebar count all see the same forgiven days. See `perdon.ts`.
   */
  const registros = useMemo(
    () =>
      perdonarTardanzas(
        filas.map((fila) => construirRegistroDia(fila, cfg)),
        cfg.tardanzasPerdonadasSemana ?? TARDANZAS_PERDONADAS_POR_DEFECTO,
      ),
    [filas, cfg],
  );

  const sectores = useMemo(() => {
    const vistos = new Set<string>();
    for (const r of registros) if (r.sector) vistos.add(r.sector);
    return [...vistos].sort((a, b) => a.localeCompare(b));
  }, [registros]);

  const valor = useMemo<ContextoHistorial>(
    () => ({
      filas,
      registros,
      sectores,
      cargando: cargando || cargandoConfiguracion,
      error,
      guardar,
      recargar,
    }),
    [filas, registros, sectores, cargando, cargandoConfiguracion, error, guardar, recargar],
  );

  return <HistorialContext.Provider value={valor}>{children}</HistorialContext.Provider>;
}

export function useHistorial(): ContextoHistorial {
  const ctx = useContext(HistorialContext);
  if (!ctx) throw new Error('useHistorial se usó fuera de <HistorialProvider>.');
  return ctx;
}
