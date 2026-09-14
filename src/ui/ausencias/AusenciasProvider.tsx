/**
 * The absence registry, loaded once and shared.
 *
 * It sits ABOVE the historial provider, which is the opposite of what the dependency
 * arrow suggests and is deliberate: `construirRegistroDia` takes the decisions already on
 * record in `cfg.ausencias` and uses them to resolve each day's motivo, so the registry has
 * to exist before the day records are derived. Without it every sidebar count would read
 * "sin clasificar" for days somebody classified last week.
 *
 * `indice` is the shape the engine wants — keyed by `${dni}|${fechaStr}` with the RAW
 * QUICKPASS date — while the registry itself is keyed by `${dni}|${YYYY-MM-DD}`, because
 * that is what a Postgres DATE is. The conversion happens once, here.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { claveAusencia } from '../../domain/fichadas/index.js';
import type { AusenciaRegistrada as DecisionDelMotor } from '../../domain/fichadas/index.js';
import { ErrorNoAutenticado } from '../http.js';
import { useSesion } from '../sesion/SesionProvider.js';
import {
  claveRegistro,
  fechaARDesdeIso,
  type AusenciaRegistrada,
  type ClaveRegistro,
} from './RepositorioAusencias.js';

interface ContextoAusencias {
  readonly ausencias: readonly AusenciaRegistrada[];
  /** Keyed `${dni}|${YYYY-MM-DD}`, for the screen. */
  readonly porClave: ReadonlyMap<ClaveRegistro, AusenciaRegistrada>;
  /** Keyed `${dni}|${DD/MM/YYYY}`, for `ConfiguracionFichadas.ausencias`. */
  readonly indiceParaElMotor: Readonly<Record<string, DecisionDelMotor>>;
  readonly cargando: boolean;
  readonly error: string | null;
  /** Re-reads the registry. Called after an upload, which re-derives it on the server. */
  recargar(): Promise<void>;
  /**
   * `true` when the registry actually changed.
   *
   * It reports rather than throws because the failure is already on screen — this provider
   * sets `error` — and the caller only needs to know whether to confirm the change to the
   * operator. Returning void made the screen say "Motivo asignado." next to the error
   * explaining that it had not been.
   */
  asignarMotivo(dni: string, fechaStr: string, motivoId: number | null): Promise<boolean>;
}

const AusenciasContext = createContext<ContextoAusencias | null>(null);

export function AusenciasProvider({ children }: { readonly children: ReactNode }) {
  const { repositorios, expirar } = useSesion();
  const repo = repositorios.ausencias;

  const [ausencias, setAusencias] = useState<readonly AusenciaRegistrada[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setAusencias(await repo.listar());
      setError(null);
    } catch (e: unknown) {
      if (e instanceof ErrorNoAutenticado) {
        expirar();
        return;
      }
      setError(e instanceof Error ? e.message : 'No se pudo leer el registro de ausencias.');
    }
  }, [repo, expirar]);

  useEffect(() => {
    let vigente = true;
    void cargar().finally(() => {
      if (vigente) setCargando(false);
    });
    return () => {
      vigente = false;
    };
  }, [cargar]);

  const asignarMotivo = useCallback(
    async (dni: string, fechaStr: string, motivoId: number | null): Promise<boolean> => {
      setError(null);
      try {
        const actualizada = await repo.asignarMotivo(dni, fechaStr, motivoId);
        setAusencias((previas) => {
          const clave = claveRegistro(actualizada.dni, actualizada.fecha);
          const existe = previas.some((a) => claveRegistro(a.dni, a.fecha) === clave);
          // The server's answer replaces the row, and it carries the attachment count, so
          // an open attachment panel does not lose its badge on a motivo change.
          return existe
            ? previas.map((a) => (claveRegistro(a.dni, a.fecha) === clave ? actualizada : a))
            : [...previas, actualizada];
        });
        return true;
      } catch (e: unknown) {
        if (e instanceof ErrorNoAutenticado) {
          expirar();
          return false;
        }
        setError(e instanceof Error ? e.message : 'No se pudo guardar el motivo.');
        return false;
      }
    },
    [repo, expirar],
  );

  const porClave = useMemo(() => {
    const mapa = new Map<ClaveRegistro, AusenciaRegistrada>();
    for (const a of ausencias) mapa.set(claveRegistro(a.dni, a.fecha), a);
    return mapa;
  }, [ausencias]);

  /**
   * What the engine reads. Only rows with a motivo are included: a registry row with none
   * is precisely "sin clasificar", and handing the engine `{ motivoId: null }` would say
   * the same thing in a second way.
   */
  const indiceParaElMotor = useMemo(() => {
    const indice: Record<string, DecisionDelMotor> = {};
    for (const a of ausencias) {
      if (a.motivoId === null) continue;
      indice[claveAusencia(a.dni, fechaARDesdeIso(a.fecha))] = {
        motivoId: a.motivoId,
        ...(a.motivoSource ? { motivoSource: a.motivoSource } : {}),
      };
    }
    return indice;
  }, [ausencias]);

  const valor = useMemo<ContextoAusencias>(
    () => ({
      ausencias,
      porClave,
      indiceParaElMotor,
      cargando,
      error,
      recargar: cargar,
      asignarMotivo,
    }),
    [ausencias, porClave, indiceParaElMotor, cargando, error, cargar, asignarMotivo],
  );

  return <AusenciasContext.Provider value={valor}>{children}</AusenciasContext.Provider>;
}

export function useAusencias(): ContextoAusencias {
  const ctx = useContext(AusenciasContext);
  if (!ctx) throw new Error('useAusencias se usó fuera de <AusenciasProvider>.');
  return ctx;
}
