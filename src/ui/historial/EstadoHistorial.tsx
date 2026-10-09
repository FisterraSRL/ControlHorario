import { Alert } from '../components/molecules/Alert/Alert.js';
import { Button } from '../components/atoms/Button/Button.js';

/** Replaces result tables so unavailable data cannot be mistaken for an empty result. */
export function EstadoHistorial({ cargando, error, onReintentar }: {
  readonly cargando: boolean;
  readonly error: string | null;
  readonly onReintentar: () => void;
}) {
  if (cargando) return <Alert tono="info">Consultando el historial…</Alert>;
  return <Alert tono="error" titulo="No se pudo consultar el historial">
    <p>{error}</p>
    <Button onClick={onReintentar}>Reintentar</Button>
  </Alert>;
}
