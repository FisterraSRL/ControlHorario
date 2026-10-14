import { Link } from 'react-router-dom';

import { Badge } from '../../atoms/Badge/Badge.js';
import { BrandLockup } from '../../atoms/BrandLockup/BrandLockup.js';
import { Icon } from '../../atoms/Icon/Icon.js';
import type { NombreIcono } from '../../atoms/Icon/Icon.js';
import type { ModuloNavegacion } from '../../../app/navegacion.js';
import { alNavegar } from '../../../app/navegacion.js';
import './Sidebar.css';

export interface ItemSidebar {
  readonly path: string;
  readonly label: string;
  readonly icono: NombreIcono;
  /** `null` for the sections that never carry a pending count. */
  readonly contador: number | null;
  readonly descripcionContador?: string;
  readonly rutas?: readonly string[];
}

export interface SidebarProps {
  readonly items: readonly ItemSidebar[];
  readonly rutaActiva: string;
  readonly onNavigate?: () => void;
}

/**
 * Presentational. It is handed the items and the active route; it does not know what a
 * fichada is and it does not compute a count.
 */
export function Sidebar({ items, rutaActiva, onNavigate }: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Secciones">
      <div className="sidebar__brand">
        <BrandLockup />
        <span className="sidebar__producto">Control de Fichadas</span>
      </div>

      <ul className="sidebar__lista">
        {items.map((item) => {
          const activo = item.rutas ? item.rutas.includes(rutaActiva) : item.path === rutaActiva;
          return (
            <li key={item.path}>
              <Link
                to={item.path}
                className={`sidebar__item${activo ? ' sidebar__item--activo' : ''}`}
                aria-current={activo ? (item.rutas && item.rutas.length > 1 ? 'location' : 'page') : undefined}
                onClick={alNavegar(onNavigate)}
              >
                <Icon nombre={item.icono} />
                <span className="sidebar__label">{item.label}</span>
                {item.contador !== null && (
                  <Badge
                    valor={item.contador}
                    alerta={item.contador > 0}
                    {...(item.descripcionContador
                      ? { descripcion: item.descripcionContador }
                      : {})}
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Native links preserve deep links, modified clicks and browser history. */
export function NavegacionModulo({ modulo, rutaActiva, onNavigate }: {
  readonly modulo: ModuloNavegacion;
  readonly rutaActiva: string;
  readonly onNavigate?: () => void;
}) {
  return (
    <nav className="module-navigation" aria-label={`Vistas de ${modulo.label}`}>
      <span className="module-navigation__label">{modulo.label}</span>
      <ul className="module-navigation__list">
        {modulo.vistas.map(vista => (
          <li key={vista.path}>
            <Link to={vista.path} aria-current={vista.path === rutaActiva ? 'page' : undefined} onClick={alNavegar(onNavigate)}>
              {vista.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
