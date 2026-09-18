/**
 * The user administration boundary, admin only.
 *
 * There is no `actualizar`: the server has no update endpoint, on purpose. Changing a role
 * or a set of sectors would have to re-prove the "an encargado has at least one sector and
 * nobody else has any" invariant in a second place — see the header of
 * src/api/rutasUsuarios.ts. So an account's role and sectors are decided when it is created
 * and nothing in this app offers to edit them afterwards.
 */

import type { RolUsuario } from '../roles.js';

export interface UsuarioAdministrado {
  readonly id: string;
  readonly email: string;
  readonly nombre: string;
  readonly rol: RolUsuario;
  /** Empty for admin and operador. Only an encargado has sectors. */
  readonly sectores: readonly string[];
  readonly activo: boolean;
  readonly creadoAt: string;
}

export interface ResultadoContrasena {
  readonly contrasenaTemporal: string;
}

export interface RepositorioUsuarios {
  listar(): Promise<readonly UsuarioAdministrado[]>;
  crear(datos: {
    email: string;
    nombre: string;
    rol: RolUsuario;
    /** Always sent, always empty unless `rol` is `encargado`. The server rejects the rest. */
    sectores: readonly string[];
  }): Promise<ResultadoContrasena>;
  cambiarEstado(id: string, activo: boolean): Promise<void>;
  reiniciarContrasena(id: string): Promise<ResultadoContrasena>;
}
