import { Link } from 'react-router-dom';

import { Badge } from '../../atoms/Badge/Badge.js';
import { BrandLockup } from '../../atoms/BrandLockup/BrandLockup.js';
import { Icon } from '../../atoms/Icon/Icon.js';
import type { NombreIcono } from '../../atoms/Icon/Icon.js';
import './Sidebar.css';

export interface ItemSidebar {
  readonly path: string;
  readonly label: string;
  readonly icono: NombreIcono;
  /** `null` for the sections that never carry a pending count. */
  readonly contador: number | null;
  readonly descripcionContador?: string;
}

export interface SidebarProps {
  readonly items: readonly ItemSidebar[];
  readonly rutaActiva: string;
}

/**
 * Presentational. It is handed the items and the active route; it does not know what a
 * fichada is and it does not compute a count.
 */
export function Sidebar({ items, rutaActiva }: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Secciones">
      <div className="sidebar__brand">
        <BrandLockup />
        <span className="sidebar__producto">Control de Fichadas</span>
      </div>

      <ul className="sidebar__lista">
        {items.map((item) => {
          const activo = item.path === rutaActiva;
          return (
            <li key={item.path}>
              <Link
                to={item.path}
                className={`sidebar__item${activo ? ' sidebar__item--activo' : ''}`}
                aria-current={activo ? 'page' : undefined}
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
