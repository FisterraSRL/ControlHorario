/** Existing routes, role authorization and landing order. Modules group these routes for navigation only. */

import type { NombreIcono } from '../components/atoms/Icon/Icon.js';
import { ROLES, type RolUsuario } from '../roles.js';

export type IdSeccion =
  | 'carga'
  | 'notificaciones'
  | 'envios'
  | 'historialNotificaciones'
  | 'ausencias'
  | 'indicador'
  | 'horas'
  | 'configuracion'
  | 'usuarios'
  | 'cuenta';

export type TipoContador = 'faltas' | 'ausenciasPendientes' | 'semanasSinClasificar';

/** Every role. The sections RRHH and administration share are spelled with this. */
const TODOS = ROLES;

export interface Seccion {
  readonly id: IdSeccion;
  readonly path: string;
  /** Full route label, independent of the module navigation. */
  readonly label: string;
  /** Topbar page title. */
  readonly titulo: string;
  readonly icono: NombreIcono;
  readonly contador: TipoContador | null;
  /**
   * Cargar datos is the one section with no period: an upload writes into the whole
   * historial, not into the window you happen to be looking at.
   */
  readonly muestraPeriodo: boolean;
  /**
   * The roles allowed to open it. This is a navigation rule, NOT a security boundary: the
   * API answers 403 on its own to anybody who types the URL, and the rows it returns are
   * already narrowed in SQL. What this prevents is a menu entry that leads to an error page.
   */
  readonly roles: readonly RolUsuario[];
}

/** «Mi cuenta» — the one section every role has, and therefore the last-resort landing. */
export const RUTA_CUENTA = '/mi-cuenta';

export const SECCIONES: readonly Seccion[] = [
  {
    id: 'carga',
    path: '/carga',
    label: 'Cargar datos',
    titulo: 'Cargar datos',
    icono: 'carga',
    contador: null,
    muestraPeriodo: false,
    roles: ['admin', 'operador'],
  },
  {
    id: 'notificaciones',
    path: '/notificaciones',
    label: 'Notificaciones',
    titulo: 'Notificaciones',
    icono: 'notificaciones',
    contador: 'faltas',
    muestraPeriodo: true,
    roles: ['admin', 'operador'],
  },
  {
    id: 'envios',
    path: '/envios',
    label: 'Documentos preparados',
    titulo: 'Documentos preparados',
    icono: 'notificaciones',
    contador: null,
    muestraPeriodo: false,
    roles: ['admin', 'operador'],
  },
  {
    id: 'historialNotificaciones',
    path: '/historial-notificaciones',
    label: 'Historial de notificaciones',
    titulo: 'Historial de notificaciones',
    icono: 'notificaciones',
    contador: null,
    muestraPeriodo: false,
    roles: ['admin', 'operador'],
  },
  {
    id: 'ausencias',
    path: '/ausencias',
    label: 'Ausencias',
    titulo: 'Ausencias',
    icono: 'ausencias',
    contador: 'ausenciasPendientes',
    muestraPeriodo: true,
    // The encargado's whole job in this app: justify the absences of their own sectors. The
    // screen is the same one RRHH uses — the server sends them fewer rows, not a different
    // shape — so there is one Ausencias screen and no forked copy to keep in step.
    roles: TODOS,
  },
  {
    id: 'indicador',
    path: '/indicador',
    label: 'Indicador',
    titulo: 'Indicador de notificaciones',
    icono: 'indicador',
    contador: null,
    muestraPeriodo: true,
    roles: ['admin', 'operador'],
  },
  {
    id: 'horas',
    path: '/horas',
    label: 'Horas trabajadas',
    titulo: 'Horas trabajadas',
    icono: 'horas',
    contador: 'semanasSinClasificar',
    muestraPeriodo: true,
    roles: ['admin', 'operador'],
  },
  {
    id: 'configuracion',
    path: '/configuracion',
    label: 'Configuración',
    titulo: 'Configuración',
    icono: 'configuracion',
    contador: null,
    muestraPeriodo: false,
    // `GET /api/configuracion` is open to an encargado — they need the motivos list to
    // justify a day — but every write on this screen answers `solo_rrhh`. A read-only
    // Configuración would be a screen whose every control fails, so it is not offered.
    roles: ['admin', 'operador'],
  },
  {
    id: 'usuarios',
    path: '/usuarios',
    label: 'Usuarios',
    titulo: 'Administración de usuarios',
    icono: 'usuarios',
    contador: null,
    muestraPeriodo: false,
    roles: ['admin'],
  },
  {
    id: 'cuenta',
    path: RUTA_CUENTA,
    label: 'Mi cuenta',
    titulo: 'Mi cuenta',
    icono: 'cuenta',
    contador: null,
    muestraPeriodo: false,
    // Changing your own password is not an administrative act: `PUT /api/sesion/contrasena`
    // only ever touches the caller's own row.
    roles: TODOS,
  },
];

export function seccionDeRuta(pathname: string): Seccion | undefined {
  return SECCIONES.find((s) => s.path === pathname);
}

/** The routes this role may open, in their existing landing order. */
export function seccionesDeRol(rol: RolUsuario): readonly Seccion[] {
  return SECCIONES.filter((s) => s.roles.includes(rol));
}

export function permiteRol(seccion: Seccion, rol: RolUsuario): boolean {
  return seccion.roles.includes(rol);
}

/**
 * Where this role lands: the first section it may open, which is `/carga` for RRHH and
 * `/ausencias` for an encargado. The fallback is unreachable — every role has «Mi cuenta» —
 * but the compiler cannot know that, and a thrown error here would be a blank app.
 */
export function rutaInicialDeRol(rol: RolUsuario): string {
  return seccionesDeRol(rol)[0]?.path ?? RUTA_CUENTA;
}

export interface VistaModulo {
  readonly path: string;
  readonly label: string;
}

export interface ModuloNavegacion {
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly icono: NombreIcono;
  readonly contador: TipoContador | null;
  readonly vistas: readonly VistaModulo[];
}

/** Grouping is presentation only; route authorization remains in SECCIONES. */
const MODULOS: readonly { readonly id: IdSeccion; readonly label?: string; readonly vistas: readonly { readonly id: IdSeccion; readonly label?: string }[] }[] = [
  { id: 'carga', vistas: [{ id: 'carga' }] },
  { id: 'ausencias', vistas: [{ id: 'ausencias' }] },
  { id: 'notificaciones', vistas: [
    { id: 'notificaciones', label: 'Preparar' },
    { id: 'envios', label: 'Preparados' },
    { id: 'historialNotificaciones', label: 'Historial' },
    { id: 'indicador', label: 'Resumen' },
  ] },
  { id: 'horas', vistas: [{ id: 'horas' }] },
  { id: 'configuracion', label: 'Administración', vistas: [{ id: 'configuracion' }, { id: 'usuarios' }] },
];

export function modulosDeRol(rol: RolUsuario): readonly ModuloNavegacion[] {
  return MODULOS.flatMap((modulo) => {
    const vistas = modulo.vistas.flatMap((vista) => {
      const seccion = SECCIONES.find(s => s.id === vista.id);
      return seccion && permiteRol(seccion, rol) ? [{ path: seccion.path, label: vista.label ?? seccion.label }] : [];
    });
    const principal = SECCIONES.find(s => s.id === modulo.id);
    if (!principal || !vistas[0]) return [];
    return [{
      id: modulo.id,
      path: vistas[0].path,
      label: modulo.label ?? principal.label,
      icono: principal.icono,
      contador: principal.contador,
      vistas,
    }];
  });
}

export function moduloDeRuta(pathname: string, rol: RolUsuario): ModuloNavegacion | undefined {
  return modulosDeRol(rol).find(modulo => modulo.vistas.some(vista => vista.path === pathname));
}

/** Modified clicks preserve the current disclosure while opening another browsing context. */
export function alNavegar(onNavigate?: () => void) {
  return (event: { readonly button: number; readonly ctrlKey: boolean; readonly metaKey: boolean; readonly shiftKey: boolean; readonly altKey: boolean }) => {
    if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) onNavigate?.();
  };
}
