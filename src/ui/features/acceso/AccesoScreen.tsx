import { useState } from 'react';

import { BrandLockup } from '../../components/atoms/BrandLockup/BrandLockup.js';
import { Button } from '../../components/atoms/Button/Button.js';
import { Input } from '../../components/atoms/Input/Input.js';
import { Alert } from '../../components/molecules/Alert/Alert.js';
import './acceso.css';

export interface AccesoScreenProps {
  readonly onEntrar: (email: string, contrasena: string) => void;
  readonly procesando: boolean;
  readonly error: string | null;
}

/**
 * Presentational. The only screen anybody sees before logging in.
 *
 * A real `<form>` with a submit button, not two fields and a click handler: Enter has to
 * submit it, and password managers only offer to fill and to save credentials on something
 * that looks like a form. `autoComplete` names the fields so the manager knows which is
 * which.
 *
 * Nothing here says whether the address exists. The server refuses to distinguish "no such
 * account" from "wrong password" — see RESPUESTA_CREDENCIALES in src/api/autenticacion.ts —
 * and a screen that helpfully said "ese correo no está registrado" would undo that.
 */
export function AccesoScreen({ onEntrar, procesando, error }: AccesoScreenProps) {
  const [email, setEmail] = useState('');
  const [contrasena, setContrasena] = useState('');

  return (
    <main className="acceso">
      <form
        className="acceso__panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (!procesando) onEntrar(email, contrasena);
        }}
      >
        <div className="acceso__marca">
          <BrandLockup />
        </div>

        <h1 className="acceso__titulo">Control de fichadas</h1>
        <p className="acceso__bajada">
          Ingresá con tu cuenta de RRHH. Si todavía no tenés una, la crea quien administra el
          servidor.
        </p>

        <div className="acceso__campos">
          <Input
            etiqueta="Correo"
            mostrarEtiqueta
            valor={email}
            onCambio={setEmail}
            type="email"
            name="email"
            autoComplete="username"
            autoFocus
            required
            disabled={procesando}
          />
          <Input
            etiqueta="Contraseña"
            mostrarEtiqueta
            valor={contrasena}
            onCambio={setContrasena}
            type="password"
            name="contrasena"
            autoComplete="current-password"
            required
            disabled={procesando}
          />
        </div>

        {error && (
          <div className="acceso__error">
            <Alert tono="error" titulo="No se pudo entrar">
              {error}
            </Alert>
          </div>
        )}

        <Button type="submit" variante="primary" disabled={procesando}>
          {procesando ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </main>
  );
}
