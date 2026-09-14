/**
 * Container for the login screen. It owns the call into the session port and the error
 * string; `AccesoScreen` takes both as props and renders.
 */

import { useCallback, useState } from 'react';

import { mensajeDeErrorSesion, useSesion } from '../../sesion/SesionProvider.js';
import { AccesoScreen } from './AccesoScreen.js';

export function AccesoContainer() {
  const { iniciar } = useSesion();
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entrar = useCallback(
    async (email: string, contrasena: string) => {
      setProcesando(true);
      setError(null);
      try {
        await iniciar(email, contrasena);
      } catch (e: unknown) {
        setError(mensajeDeErrorSesion(e));
      } finally {
        setProcesando(false);
      }
    },
    [iniciar],
  );

  return (
    <AccesoScreen
      onEntrar={(email, contrasena) => {
        void entrar(email, contrasena);
      }}
      procesando={procesando}
      error={error}
    />
  );
}
