/**
 * Presentational: props in, markup out. No repository, no fetch, no domain logic.
 *
 * It states who you are signed in as before offering to change the password, because the
 * accounts in this app are shared-office accounts and "whose password am I about to change"
 * is a real question. For an `encargado` it also names the sectors they supervise — the one
 * place in the app that says out loud what their scope is, since every screen they open is
 * already narrowed to it by the server and therefore looks like the whole company.
 */

import { Chip } from '../../components/atoms/Chip/Chip.js';
import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { ETIQUETAS_ROL, type RolUsuario } from '../../roles.js';
import { CambioDeContrasena } from './CambioDeContrasena.js';
import './micuenta.css';

export interface MiCuentaScreenProps {
  readonly nombre: string;
  readonly email: string;
  readonly rol: RolUsuario;
  readonly sectores: readonly string[];
  /** `false` on the offline adapter, where there is no account and no password. */
  readonly permiteCambiarContrasena: boolean;
  readonly onCambiarContrasena: (actual: string, nueva: string) => Promise<void>;
}

export function MiCuentaScreen({
  nombre,
  email,
  rol,
  sectores,
  permiteCambiarContrasena,
  onCambiarContrasena,
}: MiCuentaScreenProps) {
  return (
    <>
      <Card titulo="Mis datos" bajada="Tu nombre, tu rol y —si sos encargado— los sectores que supervisás.">
        <dl className="cuenta__datos">
          <div className="cuenta__dato">
            <dt>Nombre</dt>
            <dd>{nombre}</dd>
          </div>
          <div className="cuenta__dato">
            <dt>Correo</dt>
            <dd className="cuenta__mono">{email}</dd>
          </div>
          <div className="cuenta__dato">
            <dt>Rol</dt>
            <dd>{ETIQUETAS_ROL[rol]}</dd>
          </div>
          {rol === 'encargado' && (
            <div className="cuenta__dato">
              <dt>Sectores</dt>
              <dd>
                {sectores.length === 0 ? (
                  'Todavía no tenés sectores asignados.'
                ) : (
                  <span className="cuenta__sectores">
                    {sectores.map((sector) => (
                      <Chip key={sector} tono="neutral">
                        {sector}
                      </Chip>
                    ))}
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>

        <p className="cuenta__nota">
          El rol y los sectores los asigna quien administra el sistema al crear la cuenta. Si
          alguno de estos datos no es correcto, pedíselo a un administrador.
        </p>
      </Card>

      {permiteCambiarContrasena ? (
        <CambioDeContrasena onCambiar={onCambiarContrasena} />
      ) : (
        <div className="cuenta__aviso">
          <Alert tono="info" titulo="Sin servidor">
            Esta sesión corre sobre el almacenamiento de este navegador, así que no hay una
            cuenta ni una contraseña que cambiar.
          </Alert>
        </div>
      )}
    </>
  );
}
