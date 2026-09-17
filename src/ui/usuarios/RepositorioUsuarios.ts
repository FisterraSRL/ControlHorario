export type RolUsuario = 'admin' | 'operador';

export interface UsuarioAdministrado {
  readonly id: number;
  readonly email: string;
  readonly nombre: string;
  readonly rol: RolUsuario;
  readonly activo: boolean;
  readonly creadoAt: string;
}

export interface ResultadoContrasena {
  readonly contrasenaTemporal: string;
}

export interface RepositorioUsuarios {
  listar(): Promise<readonly UsuarioAdministrado[]>;
  crear(datos: { email: string; nombre: string; rol: RolUsuario }): Promise<ResultadoContrasena>;
  cambiarEstado(id: number, activo: boolean): Promise<void>;
  reiniciarContrasena(id: number): Promise<ResultadoContrasena>;
}
