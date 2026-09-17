/**
 * Password hashing. argon2id, and nothing else.
 *
 * WHY NOT A HASH. A SHA-256 of a password is a password with an extra step: a modern GPU
 * does billions of them a second, and the passwords real people choose are in every leaked
 * list already. argon2id is a *password hashing function*: it is deliberately slow and
 * deliberately memory-hungry, so the attacker who steals `usuarios` has to spend hardware
 * per guess instead of electricity per billion. The `usuarios_hash_es_phc` CHECK in
 * migration 002 makes storing anything else a database error rather than a code review.
 *
 * The parameters below are the OWASP minimum for argon2id (19 MiB, 2 iterations, 1 lane)
 * rather than the library's defaults, and they are written down here so that raising them
 * later is a visible change. They are also embedded in every hash produced — the PHC string
 * carries `m=`, `t=` and `p=` — so raising them does not invalidate existing passwords:
 * `verify` reads the parameters out of the stored hash.
 *
 * NOTHING IN THIS FILE LOGS, AND NOTHING IN THIS FILE THROWS WITH THE PASSWORD IN THE
 * MESSAGE. A plaintext password must not exist anywhere except as an argument on the way in.
 */

import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import type { Algorithm } from '@node-rs/argon2';

/**
 * `Algorithm.Argon2id`, written as its value.
 *
 * The binding is an ambient `const enum`, and `verbatimModuleSyntax` — which this project
 * has on, see tsconfig.json — forbids reading one: there is no runtime object to read it
 * from, so TypeScript would have to inline it, which is exactly what `verbatimModuleSyntax`
 * exists to stop. The value is part of the argon2 wire format and cannot change.
 *
 * It is stated rather than left to the library's default on purpose. argon2id is the choice
 * that matters here — argon2i and argon2d each give up half of what it defends against —
 * and a default is a decision somebody else can change in a minor release.
 */
const ARGON2ID = 2 as Algorithm;

/** OWASP "argon2id, second choice" profile: m=19456 KiB, t=2, p=1. */
const PARAMETROS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * A short password is not a typo, it is an account that will be guessed. Eight is the floor
 * NIST allows; this is an internal tool with a handful of accounts and a public address, so
 * twelve.
 */
export const LARGO_MINIMO_CONTRASENA = 12;

/** Above this, argon2 is being asked to hash a file. bcrypt truncates at 72; this does not,
 * but a megabyte-long "password" is a denial of service, not a login. */
export const LARGO_MAXIMO_CONTRASENA = 200;

export class ErrorContrasena extends Error {
  override readonly name = 'ErrorContrasena';
}

export function validarContrasena(contrasena: string): void {
  if (contrasena.length < LARGO_MINIMO_CONTRASENA) {
    throw new ErrorContrasena(
      `La contraseña tiene que tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres.`,
    );
  }
  if (contrasena.length > LARGO_MAXIMO_CONTRASENA) {
    throw new ErrorContrasena(
      `La contraseña no puede tener más de ${LARGO_MAXIMO_CONTRASENA} caracteres.`,
    );
  }
}

export async function hashearContrasena(contrasena: string): Promise<string> {
  validarContrasena(contrasena);
  return hash(contrasena, PARAMETROS);
}

/** One-time password returned only by an admin create/reset response. */
export function generarContrasenaTemporal(): string {
  return randomBytes(18).toString('base64url');
}

/**
 * `true` only when the password matches the stored PHC string.
 *
 * A malformed or truncated hash — a row somebody edited by hand — is a `false`, not a
 * throw: the caller is a login endpoint and it must answer the same way for every kind of
 * failure. The row is broken, the operator cannot log in, and the fix is to reset their
 * password; none of that is a 500.
 */
export async function verificarContrasena(
  hashAlmacenado: string,
  contrasena: string,
): Promise<boolean> {
  try {
    return await verify(hashAlmacenado, contrasena);
  } catch {
    return false;
  }
}

/**
 * A real argon2id hash of a value nobody knows, verified against when the email does not
 * exist.
 *
 * WITHOUT THIS, THE LOGIN LEAKS. "No such user" returns in a millisecond and "wrong
 * password" returns in the ~50 ms argon2 costs, so anybody with a stopwatch can enumerate
 * which emails have accounts — which, in a company, is a list of who works in RRHH. Doing
 * the same work in both branches removes the difference that carries the answer.
 *
 * Computed once, lazily, and kept in memory: it is the hash of a random string generated at
 * boot, so it is not a constant anybody can recognise in a heap dump either.
 */
let hashSenuelo: Promise<string> | null = null;

export function hashDeSenuelo(): Promise<string> {
  hashSenuelo ??= hash(
    // Not a password anybody will ever type. Length only affects the one-off cost.
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'),
    PARAMETROS,
  );
  return hashSenuelo;
}

/** Burns the same argon2 work a real verification would, and always answers `false`. */
export async function verificarContraSenuelo(contrasena: string): Promise<false> {
  await verificarContrasena(await hashDeSenuelo(), contrasena);
  return false;
}
