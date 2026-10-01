/**
 * Which faltas of the current period have already been notified, shared by Notificaciones
 * (which records them) and Indicador (which counts them).
 *
 * It sits INSIDE `PeriodoProvider` because it is the one read that is period-scoped: the
 * server answers a window of days, and the window is the period's. Changing the period
 * re-reads it; nothing else does.
 *
 * `notificadas` is a set of `${dni}|${YYYY-MM-DD}|${tipo}` ids (`idFaltaNotificada`), the
 * same spelling `contarNotificadas` looks up, so a key read from the server and a key built
 * from a falta on screen meet without a conversion anywhere.
 *
 * Keys recorded during this session are kept in a set of their own and unioned in, instead
 * of being merged into the server's answer: a period read that started before a `registrar`
 * and lands after it would otherwise erase what was just recorded.
 *
 * Roles that cannot open either screen (an encargado) never fire the read, which the server
 * would answer 403.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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
  const [registradasAqui, setRegistradasAqui] = useState<ReadonlySet<IdFaltaNotificada>>(
    () => new Set(),
  );
  const [cargando, setCargando] = useState(habilitado);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!habilitado) {
      setCargando(false);
      return;
    }
    let vigente = true;
    setCargando(true);
    repo
      .listar(desdeIso, hastaIso)
      .then((filas) => {
        if (!vigente) return;
        setDelPeriodo(new Set(filas.map((f) => idFaltaNotificada(f.dni, f.fecha, f.tipo))));
        setError(null);
      })
      .catch((e: unknown) => {
        if (!vigente) return;
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
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [repo, desdeIso, hastaIso, habilitado, expirar]);

  const registrar = useCallback(
    async (claves: readonly ClaveNotificada[]): Promise<boolean> => {
      try {
        await repo.registrar(claves);
        setRegistradasAqui((previas) => {
          const siguientes = new Set(previas);
          for (const c of claves) siguientes.add(idFaltaNotificada(c.dni, c.fechaIso, c.tipo));
          return siguientes;
        });
        return true;
      } catch (e: unknown) {
        if (e instanceof ErrorNoAutenticado) expirar();
        return false;
      }
    },
    [repo, expirar],
  );

  const notificadas = useMemo(() => {
    if (registradasAqui.size === 0) return delPeriodo;
    return new Set([...delPeriodo, ...registradasAqui]);
  }, [delPeriodo, registradasAqui]);

  const valor = useMemo<ContextoNotificadas>(
    () => ({ notificadas, cargando, error, registrar }),
    [notificadas, cargando, error, registrar],
  );

  return <NotificadasContext.Provider value={valor}>{children}</NotificadasContext.Provider>;
}

export function useNotificadas(): ContextoNotificadas {
  const ctx = useContext(NotificadasContext);
  if (!ctx) throw new Error('useNotificadas se usó fuera de <NotificadasProvider>.');
  return ctx;
}
