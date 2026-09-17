/**
 * The login rate limiter.
 *
 * Two counters, both fixed windows, both in memory.
 *
 * WHY NOT KEY IT ON THE CLIENT IP, WHICH IS THE OBVIOUS ANSWER. Every request to this
 * server arrives through the tunnel container over the private compose network, so
 * `request.ip` is the tunnel's address and it is the same address for everybody. An IP
 * bucket here would be one global bucket wearing a disguise: five wrong passwords from
 * anyone would lock out the whole of RRHH, and an attacker would only have to fail on
 * purpose to do it. So:
 *
 *   * the per-account counter is keyed on a HASH of the submitted email, which slows a
 *     guessing run against one account without letting anybody lock out an account they
 *     do not own for longer than the window;
 *   * the global counter bounds the total attempt rate against the whole server, which is
 *     what actually stops a spray across many emails.
 *
 * The email is hashed and not stored raw for the same reason nothing else here logs one: a
 * heap dump or a crash report should not be a list of who has an account.
 *
 * IN MEMORY, NOT IN AZURE SQL. A restart resets both counters. That is a real weakness and
 * it is accepted knowingly: there is exactly one API process, restarting it is not
 * something an attacker on the outside can do, and the alternative is a write to the
 * database on every failed login — which is itself a way to fill a disk. If this ever runs
 * more than one instance, this file is the thing that has to move.
 */

import { createHash } from 'node:crypto';

export interface LimitesLogin {
  /** Failed attempts allowed per email, per window. */
  readonly porCuenta: number;
  /** Failed attempts allowed across the whole server, per window. */
  readonly global: number;
  readonly ventanaMs: number;
}

export const LIMITES_LOGIN_POR_DEFECTO: LimitesLogin = {
  // Generous enough that an operator with caps lock on is not locked out; small enough that
  // an online guessing run against one account is hopeless.
  porCuenta: 8,
  global: 60,
  ventanaMs: 15 * 60 * 1000,
};

export interface ResultadoLimite {
  readonly permitido: boolean;
  /** Seconds until the offending window resets. Goes into `Retry-After`. */
  readonly esperaS: number;
}

interface Ventana {
  cuenta: number;
  reiniciaEn: number;
}

/**
 * A fixed window: the counter resets wholesale when the window ends.
 *
 * A sliding window would be more precise, and precision is not what this is for. The
 * imprecision is bounded by the window and it always errs in the direction of letting a
 * real operator in, which is the failure mode to prefer on a tool three people use.
 */
function golpear(mapa: Map<string, Ventana>, clave: string, limite: number, ventanaMs: number): ResultadoLimite {
  const ahora = Date.now();
  const actual = mapa.get(clave);
  if (!actual || actual.reiniciaEn <= ahora) {
    mapa.set(clave, { cuenta: 1, reiniciaEn: ahora + ventanaMs });
    return { permitido: true, esperaS: 0 };
  }
  actual.cuenta++;
  if (actual.cuenta > limite) {
    return { permitido: false, esperaS: Math.max(1, Math.ceil((actual.reiniciaEn - ahora) / 1000)) };
  }
  return { permitido: true, esperaS: 0 };
}

export interface LimitadorLogin {
  /**
   * Called BEFORE the password is checked. Counts the attempt and says whether it may
   * proceed. Counting attempts rather than failures is deliberate: a counter that only
   * increments on failure can be reset by the attacker's own successful login elsewhere.
   */
  intentar(email: string): ResultadoLimite;
  /** A successful login clears that account's counter so the operator is not punished. */
  exito(email: string): void;
  /** Drops windows that have already expired. Called on a timer by nobody; see `podar`. */
  podar(): void;
}

export function crearLimitadorLogin(
  limites: LimitesLogin = LIMITES_LOGIN_POR_DEFECTO,
): LimitadorLogin {
  const porCuenta = new Map<string, Ventana>();
  const global = new Map<string, Ventana>();

  const clave = (email: string): string =>
    createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');

  return {
    intentar(email) {
      // The global window is checked first and always counted, so a spray across a thousand
      // different emails cannot slip past by never repeating a per-account key.
      const g = golpear(global, 'todos', limites.global, limites.ventanaMs);
      if (!g.permitido) return g;
      return golpear(porCuenta, clave(email), limites.porCuenta, limites.ventanaMs);
    },
    exito(email) {
      porCuenta.delete(clave(email));
    },
    podar() {
      const ahora = Date.now();
      for (const [k, v] of porCuenta) if (v.reiniciaEn <= ahora) porCuenta.delete(k);
      for (const [k, v] of global) if (v.reiniciaEn <= ahora) global.delete(k);
    },
  };
}
