/**
 * The three kinds of account, spelled once for the whole SPA.
 *
 * THIS FILE EXISTS BECAUSE THE UNION USED TO BE WRITTEN FOUR TIMES. The session port, its
 * HTTP adapter, the users port and its HTTP adapter each carried their own
 * `'admin' | 'operador'`, and the two adapters each carried a hand-written guard over it.
 * Adding `encargado` meant finding all four; missing the one in `repositorioSesionHttp`
 * meant an encargado with the right password was told the password was wrong, because the
 * guard rejected the whole body and the login path reads a rejected body as bad credentials.
 *
 * So there is one union and one guard here, and the next role is added in this file only.
 * It mirrors `RolSesion` in src/api/sesiones.ts, which is the server's side of the same
 * contract — the two are checked against each other by the response guards that use this.
 *
 * It lives at the root of `src/ui`, beside `http.ts` and `texto.ts`, rather than inside
 * `sesion/` or `usuarios/`: both of those import it, and neither owns it.
 */

export type RolUsuario = 'admin' | 'operador' | 'encargado';

/** Every role, in the order a person reading a list of them expects. */
export const ROLES: readonly RolUsuario[] = ['admin', 'operador', 'encargado'];

/**
 * The roles the alta form hands out. `operador` is deliberately NOT one of them.
 *
 * THE DIFFERENCE BETWEEN THIS LIST AND `ROLES` IS THE WHOLE POINT. This product has two
 * kinds of account — the company, who administers, and the client, who supervises their
 * sectors — so `operador` stopped being something to create. It did not stop EXISTING:
 * `rol` defaults to `N'operador'` in the database (migration 003) and the `crearUsuario`
 * CLI relies on that default, so accounts with that role are already out there, and the
 * offline adapter signs in as one. Dropping it from `RolUsuario` would lock those people
 * out and read their session body as bad credentials.
 *
 * So `ROLES` stays complete — it is what the app can UNDERSTAND — and this list is what the
 * app OFFERS. An existing operador keeps working and still renders with its own label.
 */
export const ROLES_ASIGNABLES: readonly RolUsuario[] = ['admin', 'encargado'];

/** Whether this is a role the alta form may create. Narrower than `esRolUsuario`. */
export function esRolAsignable(valor: unknown): valor is RolUsuario {
  return esRolUsuario(valor) && ROLES_ASIGNABLES.includes(valor);
}

/** The one narrowing check. Every response guard in the app goes through it. */
export function esRolUsuario(valor: unknown): valor is RolUsuario {
  return valor === 'admin' || valor === 'operador' || valor === 'encargado';
}

/** What each role is called on screen. Spanish, like the rest of the UI. */
export const ETIQUETAS_ROL: Readonly<Record<RolUsuario, string>> = {
  admin: 'Administrador',
  operador: 'Operador',
  encargado: 'Encargado',
};

/**
 * A list of sectors as it arrives over HTTP, or `[]`.
 *
 * Lenient on purpose: an absent or malformed `sectores` must never make a whole session or
 * user body unreadable. `[]` is also the honest answer for admin and operador, whose scope
 * is the absence of one — see `alcanceDeSectores` in src/api/autenticacion.ts.
 */
export function leerSectores(valor: unknown): readonly string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((s): s is string => typeof s === 'string');
}
