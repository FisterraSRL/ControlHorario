/**
 * Container for Mi cuenta. It reads the session and owns the one call into a repository.
 *
 * The 401 handling is the same one Configuración used to do for this action: a password
 * change that comes back unauthenticated means the session ended while the form was open,
 * which is `expirar()` and the login screen — not an error message on a screen that is
 * about to disappear.
 */

import { useSesion } from '../../sesion/SesionProvider.js';
import { MiCuentaScreen } from './MiCuentaScreen.js';

export function MiCuentaContainer() {
  const { repositorios, sesion, expirar } = useSesion();
  const operador = sesion?.operador ?? null;

  return (
    <MiCuentaScreen
      nombre={operador?.nombre ?? ''}
      email={operador?.email ?? ''}
      rol={operador?.rol ?? 'operador'}
      sectores={operador?.sectores ?? []}
      permiteCambiarContrasena={repositorios.conServidor}
      onCambiarContrasena={async (actual, nueva) => {
        try {
          await repositorios.sesion.cambiarContrasena(actual, nueva);
        } catch (e: unknown) {
          if (e instanceof Error && e.name === 'ErrorNoAutenticado') expirar();
          throw e;
        }
      }}
    />
  );
}
