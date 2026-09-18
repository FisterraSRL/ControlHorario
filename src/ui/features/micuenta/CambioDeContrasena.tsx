/**
 * Changing your own password.
 *
 * It used to live inside `ConfiguracionScreen`, which is an administration screen an
 * `encargado` never opens — so the one action every account needs was behind the one screen
 * two of the three roles are not allowed to see. It was lifted out here rather than copied:
 * a second copy is a second set of validation rules to keep in step, and the rules are the
 * only thing standing between a typo and a locked-out account.
 *
 * Presentational: it owns the three fields and nothing else. Whether there is a server to
 * talk to, and what a 401 means, are the container's problem.
 */

import { useState } from 'react';

import { Button } from '../../components/atoms/Button/Button.js';
import { Input } from '../../components/atoms/Input/Input.js';
import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Card } from '../../components/molecules/Card/Card.js';

/** The server's own floor, restated here so a rejected write is not the first sign of it. */
export const LARGO_MINIMO_CONTRASENA = 12;

export interface CambioDeContrasenaProps {
  readonly onCambiar: (actual: string, nueva: string) => Promise<void>;
}

export function CambioDeContrasena({ onCambiar }: CambioDeContrasenaProps) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<{ tono: 'error' | 'ok'; mensaje: string } | null>(null);

  const guardar = async (): Promise<void> => {
    if (nueva.length < LARGO_MINIMO_CONTRASENA) {
      setResultado({ tono: 'error', mensaje: 'La contraseña nueva debe tener al menos 12 caracteres.' });
      return;
    }
    if (nueva !== confirmacion) {
      setResultado({ tono: 'error', mensaje: 'La confirmación no coincide con la contraseña nueva.' });
      return;
    }
    setGuardando(true);
    setResultado(null);
    try {
      await onCambiar(actual, nueva);
      setActual(''); setNueva(''); setConfirmacion('');
      setResultado({ tono: 'ok', mensaje: 'Contraseña actualizada. Las demás sesiones de tu cuenta fueron cerradas.' });
    } catch (e: unknown) {
      setResultado({ tono: 'error', mensaje: e instanceof Error ? e.message : 'No se pudo cambiar la contraseña.' });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Card titulo="Mi contraseña" bajada="Cambiá la contraseña de tu propia cuenta. Debe tener al menos 12 caracteres.">
      <div className="cuenta__contrasena">
        <Input etiqueta="Contraseña actual" mostrarEtiqueta type="password" autoComplete="current-password" valor={actual} onCambio={setActual} maxLength={200} />
        <Input etiqueta="Contraseña nueva" mostrarEtiqueta type="password" autoComplete="new-password" valor={nueva} onCambio={setNueva} minLength={LARGO_MINIMO_CONTRASENA} maxLength={200} />
        <Input etiqueta="Repetir contraseña nueva" mostrarEtiqueta type="password" autoComplete="new-password" valor={confirmacion} onCambio={setConfirmacion} minLength={LARGO_MINIMO_CONTRASENA} maxLength={200} />
        <Button variante="primary" disabled={guardando || !actual || !nueva || !confirmacion} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Cambiar contraseña'}</Button>
      </div>
      {resultado && <div className="cuenta__aviso cuenta__aviso--interno"><Alert tono={resultado.tono}>{resultado.mensaje}</Alert></div>}
    </Card>
  );
}
