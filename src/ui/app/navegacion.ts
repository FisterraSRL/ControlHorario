/**
 * The six sections of the app, in the order the sidebar shows them — the same order and the
 * same labels the legacy file used, because the people who use this every day navigate it
 * by position.
 *
 * `contador` names which pending count the sidebar badge shows, or `null` for the sections
 * that never had one (Cargar datos, Indicador, Configuración).
 */

import type { NombreIcono } from '../components/atoms/Icon/Icon.js';

export type IdSeccion =
  | 'carga'
  | 'notificaciones'
  | 'ausencias'
  | 'indicador'
  | 'horas'
  | 'configuracion'
  | 'usuarios';

export type TipoContador = 'faltas' | 'ausenciasPendientes' | 'semanasSinClasificar';

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
}

export const SECCIONES: readonly Seccion[] = [
  {
    id: 'carga',
    path: '/carga',
    label: 'Cargar datos',
    titulo: 'Cargar datos',
    icono: 'carga',
    contador: null,
    muestraPeriodo: false,
  },
  {
    id: 'notificaciones',
    path: '/notificaciones',
    label: 'Notificaciones',
    titulo: 'Notificaciones',
    icono: 'notificaciones',
    contador: 'faltas',
    muestraPeriodo: true,
  },
  {
    id: 'ausencias',
    path: '/ausencias',
    label: 'Ausencias',
    titulo: 'Ausencias',
    icono: 'ausencias',
    contador: 'ausenciasPendientes',
    muestraPeriodo: true,
  },
  {
    id: 'indicador',
    path: '/indicador',
    label: 'Indicador',
    titulo: 'Indicador de notificaciones',
    icono: 'indicador',
    contador: null,
    muestraPeriodo: true,
  },
  {
    id: 'horas',
    path: '/horas',
    label: 'Horas trabajadas',
    titulo: 'Horas trabajadas',
    icono: 'horas',
    contador: 'semanasSinClasificar',
    muestraPeriodo: true,
  },
  {
    id: 'configuracion',
    path: '/configuracion',
    label: 'Configuración',
    titulo: 'Configuración',
    icono: 'configuracion',
    contador: null,
    muestraPeriodo: false,
  },
  {
    id: 'usuarios',
    path: '/usuarios',
    label: 'Usuarios',
    titulo: 'Administración de usuarios',
    icono: 'usuarios',
    contador: null,
    muestraPeriodo: false,
  },
];

export const RUTA_INICIAL = '/carga';

export function seccionDeRuta(pathname: string): Seccion | undefined {
  return SECCIONES.find((s) => s.path === pathname);
}
