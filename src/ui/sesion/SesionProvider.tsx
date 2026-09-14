/**
 * Who is logged in, and what the rest of the app does when nobody is.
 *
 * It owns three things and nothing else: the current session, the login call, and the
 * single `expirar()` that every other provider calls when a request comes back 401. That
 * last one is why this is a provider and not a hook per screen — a session ends once, and
 * every screen open at that moment has to agree about it.
 *
 * The repositories are created HERE, once, and handed down. They are created together (see
 * `repositorios.ts`) so a build cannot end up with the historial on the server and the
 * registry in localStorage.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { crearRepositorios, type Repositorios } from '../repositorios.js';
import { ErrorSesion, type Sesion } from './RepositorioSesion.js';

interface ContextoSesion {
  readonly sesion: Sesion | null;
  /** True until the first `actual()` answers. The app shows nothing decisive before that. */
  readonly cargando: boolean;
  readonly repositorios: Repositorios;
  iniciar(email: string, contrasena: string): Promise<void>;
  cerrar(): Promise<void>;
  /**
   * Called by every other provider when a request answers 401.
   *
   * Drops the session so the shell renders the login screen. It does not call the server:
   * the server is precisely the thing that just said the session is gone.
   */
  expirar(): void;
}

const SesionContext = createContext<ContextoSesion | null>(null);

export function SesionProvider({
  children,
  repositorios,
}: {
  readonly children: ReactNode;
  /** Injected in full by a test or a story; otherwise decided by `crearRepositorios`. */
  readonly repositorios?: Repositorios;
}) {
  const [repos] = useState<Repositorios>(() => repositorios ?? crearRepositorios());
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vigente = true;
    repos.sesion
      .actual()
      .then((s) => {
        if (vigente) setSesion(s);
      })
      .catch(() => {
        // `actual()` answers null for "nobody is logged in"; anything that throws is the
        // server being unreachable. Treated as logged out: the login screen is the one
        // place that can explain it and let them try again.
        if (vigente) setSesion(null);
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [repos]);

  const iniciar = useCallback(
    async (email: string, contrasena: string) => {
      setSesion(await repos.sesion.iniciar(email, contrasena));
    },
    [repos],
  );

  const cerrar = useCallback(async () => {
    try {
      await repos.sesion.cerrar();
    } finally {
      // Whatever the server said, this browser is done. A failed logout that left the
      // screen logged in would be the worst possible outcome of clicking "Salir".
      setSesion(null);
    }
  }, [repos]);

  const expirar = useCallback(() => {
    setSesion(null);
  }, []);

  const valor = useMemo<ContextoSesion>(
    () => ({ sesion, cargando, repositorios: repos, iniciar, cerrar, expirar }),
    [sesion, cargando, repos, iniciar, cerrar, expirar],
  );

  return <SesionContext.Provider value={valor}>{children}</SesionContext.Provider>;
}

export function useSesion(): ContextoSesion {
  const ctx = useContext(SesionContext);
  if (!ctx) throw new Error('useSesion se usó fuera de <SesionProvider>.');
  return ctx;
}

/** The message to show for a failed login, without leaking which part was wrong. */
export function mensajeDeErrorSesion(e: unknown): string {
  if (e instanceof ErrorSesion) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return 'No se pudo iniciar sesión. Volvé a intentar en un momento.';
}
