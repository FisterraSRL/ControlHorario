import type { UsuarioAdministrado } from '../../usuarios/RepositorioUsuarios.js';
export interface AccionUsuario { readonly tipo: 'desactivar' | 'reiniciar'; readonly usuario: UsuarioAdministrado }
export interface EstadoConfirmacion { readonly accion: AccionUsuario | null; readonly ocupado: boolean; readonly fallo: boolean }
/** Only confirmation executes an action; failed attempts retain the same identified user. */
export function crearConfirmacionUsuario(ejecutar: (accion: AccionUsuario) => Promise<boolean>) {
  let estado: EstadoConfirmacion = { accion: null, ocupado: false, fallo: false };
  const listeners = new Set<() => void>();
  const publicar = (nuevo: EstadoConfirmacion) => { estado = nuevo; listeners.forEach(fn => fn()); };
  return {
    estado: () => estado,
    suscribir(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    pedir(accion: AccionUsuario) { if (!estado.ocupado) publicar({ accion, ocupado: false, fallo: false }); },
    cancelar() { if (!estado.ocupado) publicar({ accion: null, ocupado: false, fallo: false }); },
    async confirmar() {
      if (estado.ocupado || !estado.accion) return;
      const accion = estado.accion; publicar({ accion, ocupado: true, fallo: false });
      let ok = false;
      try { ok = await ejecutar(accion); }
      catch { ok = false; }
      finally { publicar({ accion: ok ? null : accion, ocupado: false, fallo: !ok }); }
    },
  };
}
