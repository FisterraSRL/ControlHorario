import { Card } from '../components/molecules/Card/Card.js';
import './PlaceholderScreen.css';

export interface PlaceholderScreenProps {
  readonly titulo: string;
  /** What this screen will do, in the words the legacy version used for it. */
  readonly descripcion: string;
  /** Which slice builds it. */
  readonly slice: string;
}

/**
 * PLACEHOLDER — not a screen.
 *
 * Five of the six sections are routed but not built, so that navigation, the sidebar counts
 * and the período control can be exercised end to end. Each one says plainly that it is
 * empty rather than rendering a convincing but inert imitation of the real thing.
 */
export function PlaceholderScreen({ titulo, descripcion, slice }: PlaceholderScreenProps) {
  return (
    <Card titulo={titulo} bajada={descripcion}>
      <div className="placeholder">
        <p className="placeholder__marca">Pantalla no implementada</p>
        <p className="placeholder__detalle">
          Se construye en el <b>{slice}</b>. Lo que ves acá no es una versión reducida de la
          pantalla: todavía no hay nada.
        </p>
      </div>
    </Card>
  );
}
