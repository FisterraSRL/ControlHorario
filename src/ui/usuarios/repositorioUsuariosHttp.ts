import { conJson, esObjeto, pedir, pedirJson, ErrorApi } from '../http.js';
import type { RepositorioUsuarios, RolUsuario, UsuarioAdministrado } from './RepositorioUsuarios.js';

function esRol(v: unknown): v is RolUsuario { return v === 'admin' || v === 'operador'; }
export function leerUsuarioAdministrado(v: unknown): UsuarioAdministrado | null {
  if (!esObjeto(v)) return null;
  const id = typeof v['id'] === 'string' ? v['id'] :
    typeof v['id'] === 'number' && Number.isSafeInteger(v['id']) ? String(v['id']) : null;
  return id !== null && /^[1-9][0-9]{0,18}$/.test(id) && typeof v['email'] === 'string' &&
    typeof v['nombre'] === 'string' && esRol(v['rol']) && typeof v['activo'] === 'boolean' &&
    typeof v['creadoAt'] === 'string' ? { id, email: v['email'], nombre: v['nombre'], rol: v['rol'], activo: v['activo'], creadoAt: v['creadoAt'] } : null;
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
      return cuerpo['usuarios'].map(leerUsuarioAdministrado).filter((u): u is UsuarioAdministrado => u !== null);
    },
    async crear(datos) { return contrasena(await pedirJson(raiz, conJson('POST', datos))); },
    async cambiarEstado(id, activo) { await pedir(`${raiz}/estado`, conJson('PUT', { id, activo })); },
    async reiniciarContrasena(id) { return contrasena(await pedirJson(`${raiz}/reiniciar-contrasena`, conJson('POST', { id }))); },
  };
}
