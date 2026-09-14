import { pluralizar } from '../../../texto.js';
import './Badge.css';

export interface BadgeProps {
  readonly valor: number;
  /** A count that needs attention is rendered in the danger colour, not just bolder. */
  readonly alerta?: boolean;
  /** Read out to screen readers, e.g. "3 pendientes de clasificar". */
  readonly descripcion?: string;
}

/** Presentational. The pending-count pill in the sidebar. */
export function Badge({ valor, alerta = false, descripcion }: BadgeProps) {
  return (
    <span className={`badge${alerta ? ' badge--alerta' : ''}`}>
      <span aria-hidden="true">{valor}</span>
      <span className="badge__sr">
        {descripcion ?? pluralizar(valor, 'pendiente', 'pendientes')}
      </span>
    </span>
  );
}
