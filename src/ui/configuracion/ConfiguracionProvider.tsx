/**
 * The configuration, loaded once and shared.
 *
 * It sits above the historial because the engine needs it: `construirRegistroDia` takes the
 * sector rules and the thresholds, and a screen that rendered before the configuration
 * arrived would show faults computed with the defaults and then silently change its mind.
 *
 * Every mutation goes to the repository and takes the SERVER'S answer as the new state
 * rather than the value the screen sent. Two operators editing the tolerancia at the same
 * moment is not a race anybody will notice on a three-person tool, but a screen that shows
 * a value the server rejected is a screen that lies, and this is the screen whose numbers
 * decide who gets a disciplinary letter.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { ConfiguracionFichadas, Motivo } from '../../domain/fichadas/index.js';
import { ErrorNoAutenticado } from '../http.js';
import { useSesion } from '../sesion/SesionProvider.js';
import type {
  ConfiguracionGuardada,
  ParametrosConfiguracion,
} from './RepositorioConfiguracion.js';

interface ContextoConfiguracion {
  readonly configuracion: ConfiguracionGuardada | null;
  /** The same values shaped for the engine. Never null: falls back to the defaults. */
  readonly paraElMotor: ConfiguracionFichadas;
  readonly cargando: boolean;
  readonly error: string | null;
  guardarParametros(cambios: Partial<ParametrosConfiguracion>): Promise<void>;
  guardarReglaSector(sector: string, fichadasRequeridas: number): Promise<void>;
  crearMotivo(label: string, worked: boolean): Promise<void>;
  editarMotivo(id: number, worked: boolean): Promise<void>;
  retirarMotivo(id: number): Promise<void>;
  agregarExclusion(dni: string, motivoTexto: string | null): Promise<void>;
  quitarExclusion(dni: string): Promise<void>;
}

const ConfiguracionContext = createContext<ContextoConfiguracion | null>(null);

/**
 * What the engine runs with before the configuration has arrived, and if it never does.
 *
 * Empty rather than clever: `construirRegistroDia` falls back to four fichadas, 30 minutes
 * of break and no tolerance, which are the engine's own documented defaults. Guessing
 * anything else here would mean two places that decide what "normal" is.
 */
const MOTOR_VACIO: ConfiguracionFichadas = {};

export function ConfiguracionProvider({ children }: { readonly children: ReactNode }) {
  const { repositorios, expirar } = useSesion();
  const repo = repositorios.configuracion;

  const [configuracion, setConfiguracion] = useState<ConfiguracionGuardada | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * A 401 is not an error to show: it is the session ending, and the shell handles it.
   *
   * It does NOT rethrow. Every caller is a `void guardar…()` from an event handler, and a
   * rethrow there is an unhandled rejection in the console and nothing else — the failure
   * is already on screen through `error`.
   */
  const manejar = useCallback(
    (e: unknown): void => {
      if (e instanceof ErrorNoAutenticado) {
        expirar();
        return;
      }
      setError(e instanceof Error ? e.message : 'No se pudo guardar la configuración.');
    },
    [expirar],
  );

  useEffect(() => {
    let vigente = true;
    repo
      .leer()
      .then((c) => {
        if (vigente) setConfiguracion(c);
      })
      .catch((e: unknown) => {
        if (!vigente) return;
        if (e instanceof ErrorNoAutenticado) {
          expirar();
          return;
        }
        setError(e instanceof Error ? e.message : 'No se pudo leer la configuración.');
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [repo, expirar]);

  const aplicar = useCallback(
    (cambio: (previa: ConfiguracionGuardada) => ConfiguracionGuardada) => {
      setConfiguracion((previa) => (previa ? cambio(previa) : previa));
    },
    [],
  );

  const guardarParametros = useCallback(
    async (cambios: Partial<ParametrosConfiguracion>) => {
      setError(null);
      try {
        const parametros = await repo.guardarParametros(cambios);
        aplicar((previa) => ({ ...previa, parametros }));
      } catch (e: unknown) {
        manejar(e);
      }
    },
    [repo, aplicar, manejar],
  );

  const guardarReglaSector = useCallback(
    async (sector: string, fichadasRequeridas: number) => {
      setError(null);
      try {
        const reglasSector = await repo.guardarReglaSector(sector, fichadasRequeridas);
        aplicar((previa) => ({ ...previa, reglasSector }));
      } catch (e: unknown) {
        manejar(e);
      }
    },
    [repo, aplicar, manejar],
  );

  const crearMotivo = useCallback(
    async (label: string, worked: boolean) => {
      setError(null);
      try {
        const motivo = await repo.crearMotivo(label, worked);
        aplicar((previa) => ({ ...previa, motivos: [...previa.motivos, motivo] }));
      } catch (e: unknown) {
        manejar(e);
      }
    },
    [repo, aplicar, manejar],
  );

  const editarMotivo = useCallback(
    async (id: number, worked: boolean) => {
      setError(null);
      try {
        const motivo = await repo.editarMotivo(id, worked);
        aplicar((previa) => ({
          ...previa,
          motivos: previa.motivos.map((m: Motivo) => (m.id === id ? motivo : m)),
        }));
      } catch (e: unknown) {
        manejar(e);
      }
    },
    [repo, aplicar, manejar],
  );

  const retirarMotivo = useCallback(
    async (id: number) => {
      setError(null);
      try {
        await repo.retirarMotivo(id);
        aplicar((previa) => ({
          ...previa,
          motivos: previa.motivos.filter((m: Motivo) => m.id !== id),
        }));
      } catch (e: unknown) {
        manejar(e);
      }
    },
    [repo, aplicar, manejar],
  );

  const agregarExclusion = useCallback(
    async (dni: string, motivoTexto: string | null) => {
      setError(null);
      try {
        const exclusion = await repo.agregarExclusion(dni, motivoTexto);
        aplicar((previa) => ({
          ...previa,
          exclusiones: [...previa.exclusiones.filter((e) => e.dni !== dni), exclusion].sort(
            (a, b) => a.dni.localeCompare(b.dni),
          ),
        }));
      } catch (e: unknown) {
        manejar(e);
      }
    },
    [repo, aplicar, manejar],
  );

  const quitarExclusion = useCallback(
    async (dni: string) => {
      setError(null);
      try {
        await repo.quitarExclusion(dni);
        aplicar((previa) => ({
          ...previa,
          exclusiones: previa.exclusiones.filter((e) => e.dni !== dni),
        }));
      } catch (e: unknown) {
        manejar(e);
      }
    },
    [repo, aplicar, manejar],
  );

  const paraElMotor = useMemo<ConfiguracionFichadas>(() => {
    if (!configuracion) return MOTOR_VACIO;
    return {
      reglasSector: configuracion.reglasSector,
      dniExcluidos: configuracion.exclusiones.map((e) => e.dni),
      motivos: configuracion.motivos,
      descansoMaxMin: configuracion.parametros.descansoMaxMin,
      toleranciaMin: configuracion.parametros.toleranciaMin,
      horasTurnoSemanales: configuracion.parametros.horasTurnoSemanales,
    };
  }, [configuracion]);

  const valor = useMemo<ContextoConfiguracion>(
    () => ({
      configuracion,
      paraElMotor,
      cargando,
      error,
      guardarParametros,
      guardarReglaSector,
      crearMotivo,
      editarMotivo,
      retirarMotivo,
      agregarExclusion,
      quitarExclusion,
    }),
    [
      configuracion,
      paraElMotor,
      cargando,
      error,
      guardarParametros,
      guardarReglaSector,
      crearMotivo,
      editarMotivo,
      retirarMotivo,
      agregarExclusion,
      quitarExclusion,
    ],
  );

  return (
    <ConfiguracionContext.Provider value={valor}>{children}</ConfiguracionContext.Provider>
  );
}

export function useConfiguracion(): ContextoConfiguracion {
  const ctx = useContext(ConfiguracionContext);
  if (!ctx) throw new Error('useConfiguracion se usó fuera de <ConfiguracionProvider>.');
  return ctx;
}
