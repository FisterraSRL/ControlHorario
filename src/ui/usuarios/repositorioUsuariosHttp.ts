import { conJson, esObjeto, pedir, pedirJson, ErrorApi } from '../http.js';
import type { RepositorioUsuarios, RolUsuario, UsuarioAdministrado } from './RepositorioUsuarios.js';

function esRol(v: unknown): v is RolUsuario { return v === 'admin' || v === 'operador'; }
function usuario(v: unknown): UsuarioAdministrado | null {
  if (!esObjeto(v)) return null;
  return typeof v['id'] === 'number' && typeof v['email'] === 'string' &&
    typeof v['nombre'] === 'string' && esRol(v['rol']) && typeof v['activo'] === 'boolean' &&
    typeof v['creadoAt'] === 'string' ? v as unknown as UsuarioAdministrado : null;
}
function contrasena(v: unknown): { contrasenaTemporal: string } {
  if (!esObjeto(v) || typeof v['contrasenaTemporal'] !== 'string') throw new ErrorApi('El servidor no devolvió la contraseña temporal.');
  return { contrasenaTemporal: v['contrasenaTemporal'] };
}

export function crearRepositorioUsuariosHttp(base: string): RepositorioUsuarios {
  const raiz = `${base}/admin/usuarios`;
  return {
    async listar() {
      const cuerpo = await pedirJson(raiz);
      if (!esObjeto(cuerpo) || !Array.isArray(cuerpo['usuarios'])) throw new ErrorApi('No se pudo leer la lista de usuarios.');
      return cuerpo['usuarios'].map(usuario).filter((u): u is UsuarioAdministrado => u !== null);
    },
    async crear(datos) { return contrasena(await pedirJson(raiz, conJson('POST', datos))); },
    async cambiarEstado(id, activo) { await pedir(`${raiz}/estado`, conJson('PUT', { id, activo })); },
    async reiniciarContrasena(id) { return contrasena(await pedirJson(`${raiz}/reiniciar-contrasena`, conJson('POST', { id }))); },
  };
}
