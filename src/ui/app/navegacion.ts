/**
 * The sections of the app, in the order the sidebar shows them — the same order and the
 * same labels the legacy file used, because the people who use this every day navigate it
 * by position.
 *
 * `contador` names which pending count the sidebar badge shows, or `null` for the sections
 * that never had one (Cargar datos, Indicador, Configuración, Mi cuenta).
 *
 * WHO SEES WHAT IS A FIELD ON THE SECTION, not a condition at each call site. It used to be
 * two hardcoded `id === 'usuarios'` exceptions — one in the sidebar, one in the route table —
 * which is two places to update and one place to forget. With `roles` here, the sidebar and
 * the route guards read the same list, and a section nobody wrote a rule for is simply not
 * reachable rather than accidentally public.
 *
 * THE LANDING ROUTE IS DERIVED FROM IT for the same reason. It used to be the constant
 * `/carga`, which an `encargado` gets a 403 from: sending somebody to a screen their role
 * cannot open is how a redirect loop or a blank page starts. `rutaInicialDeRol` answers with
 * the first section that role may actually open, so the answer cannot go stale when the
 * table below changes.
 */

import type { NombreIcono } from '../components/atoms/Icon/Icon.js';
import { ROLES, type RolUsuario } from '../roles.js';

export type IdSeccion =
  | 'carga'
  | 'notificaciones'
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
  /** Sidebar label. */
  readonly label: string;
  /** Topbar page title. Only Indicador differs from its sidebar label. */
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

/** The sections this role may open, in sidebar order. */
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
