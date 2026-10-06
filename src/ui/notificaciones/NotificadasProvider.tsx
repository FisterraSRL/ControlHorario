/** Period-scoped marks shared by Notificaciones and Indicador.
 * A mutation invalidates pending reads synchronously, then reloads authoritative marks.
 * No additive session overlay can resurrect a mark removed from the history panel.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { fmtFechaISO } from '../../domain/fichadas/index.js';
import { permiteRol, SECCIONES } from '../app/navegacion.js';
import { idFaltaNotificada, type ClaveNotificada, type IdFaltaNotificada } from '../faltas/porDia.js';
import { ErrorNoAutenticado } from '../http.js';
import { usePeriodo } from '../periodo/PeriodoProvider.js';
import { useSesion } from '../sesion/SesionProvider.js';

interface ContextoNotificadas {
  /** Notified keys of the current period, plus everything recorded in this session. */
  readonly notificadas: ReadonlySet<IdFaltaNotificada>;
  readonly cargando: boolean;
  /** A failed READ. A failed `registrar` is reported by its return value instead. */
  readonly error: string | null;
  /**
   * Records `claves` as notified. `true` only when every key is on record; the caller must
   * not hand the document over otherwise. It reports rather than throws, like
   * `asignarMotivo`, because the caller only has to decide whether to download.
   */
  registrar(claves: readonly ClaveNotificada[]): Promise<boolean>;
  recargar(): void;
}

const NotificadasContext = createContext<ContextoNotificadas | null>(null);

/** The sections whose screens read this provider. */
const SECCIONES_QUE_LO_USAN = new Set(['notificaciones', 'indicador']);

export function NotificadasProvider({ children }: { readonly children: ReactNode }) {
  const { sesion, repositorios, expirar } = useSesion();
  const repo = repositorios.notificaciones;
  const { rango } = usePeriodo();

  const rol = sesion?.operador.rol;
  const habilitado =
    rol !== undefined &&
    SECCIONES.some((s) => SECCIONES_QUE_LO_USAN.has(s.id) && permiteRol(s, rol));

  // Strings, so the effect depends on the window and not on the identity of two Dates.
  const desdeIso = fmtFechaISO(rango.desde);
  const hastaIso = fmtFechaISO(rango.hasta);

  const [delPeriodo, setDelPeriodo] = useState<ReadonlySet<IdFaltaNotificada>>(() => new Set());
  const [revision, setRevision] = useState(0);
  const generacion = useRef(0);
  const recargar = useCallback(() => { generacion.current++; setDelPeriodo(new Set()); setRevision(v => v + 1); }, []);
  const [cargando, setCargando] = useState(habilitado);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!habilitado) {
      setCargando(false);
      return;
    }
    let vigente = true;
    const version = generacion.current;
    setCargando(true);
    repo
      .listar(desdeIso, hastaIso)
      .then((filas) => {
        if (!vigente || version !== generacion.current) return;
        setDelPeriodo(new Set(filas.map((f) => idFaltaNotificada(f.dni, f.fecha, f.tipo))));
        setError(null);
      })
      .catch((e: unknown) => {
        if (!vigente || version !== generacion.current) return;
        if (e instanceof ErrorNoAutenticado) {
          expirar();
          return;
        }
        // The previous period's keys would be wrong for this one: start from nothing.
        setDelPeriodo(new Set());
        setError(
          e instanceof Error ? e.message : 'No se pudo leer qué faltas ya están notificadas.',
        );
      })
      .finally(() => {
        if (vigente && version === generacion.current) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [repo, desdeIso, hastaIso, habilitado, expirar, revision]);

  const registrar = useCallback(
    async (claves: readonly ClaveNotificada[]): Promise<boolean> => {
      try {
        await repo.registrar(claves);
        recargar();
        return true;
      } catch (e: unknown) {
        if (e instanceof ErrorNoAutenticado) expirar();
        return false;
      }
    },
    [repo, expirar, recargar],
  );

  const notificadas = delPeriodo;

  const valor = useMemo<ContextoNotificadas>(
    () => ({ notificadas, cargando, error, registrar, recargar }),
    [notificadas, cargando, error, registrar, recargar],
  );

  return <NotificadasContext.Provider value={valor}>{children}</NotificadasContext.Provider>;
}

export function useNotificadas(): ContextoNotificadas {
  const ctx = useContext(NotificadasContext);
  if (!ctx) throw new Error('useNotificadas se usó fuera de <NotificadasProvider>.');
  return ctx;
}
