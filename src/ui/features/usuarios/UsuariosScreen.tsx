/**
 * Presentational. The one screen that decides somebody's role, and therefore the one screen
 * where a mistake is not undoable from inside the app: there is no update endpoint, so a
 * wrong role or a wrong set of sectors is fixed by deactivating the account and creating
 * another one. That is why the sector picker offers a closed list and why the submit is
 * blocked rather than letting the server refuse — see `usuarios.ts` for the rules.
 */

import { useState } from 'react';

import { Button } from '../../components/atoms/Button/Button.js';
import { Checkbox } from '../../components/atoms/Checkbox/Checkbox.js';
import { Chip } from '../../components/atoms/Chip/Chip.js';
import { Input } from '../../components/atoms/Input/Input.js';
import { Select } from '../../components/atoms/Select/Select.js';
import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { FilaVacia, Table } from '../../components/molecules/Table/Table.js';
import { ETIQUETAS_ROL, ROLES_ASIGNABLES, esRolAsignable, type RolUsuario } from '../../roles.js';
import type { UsuarioAdministrado } from '../../usuarios/RepositorioUsuarios.js';
import { problemaDelAlta, sectoresParaCrear } from './usuarios.js';
import './usuarios.css';

interface Props {
  usuarios: readonly UsuarioAdministrado[]; cargando: boolean; error: string | null;
  usuarioActual: string; contrasenaTemporal: string | null;
  /** The closed list an encargado may be scoped to. Empty until a planilla is loaded. */
  sectoresDisponibles: readonly string[];
  onCrear(datos: { email: string; nombre: string; rol: RolUsuario; sectores: readonly string[] }): void;
  onEstado(id: string, activo: boolean): void; onReiniciar(id: string): void; onCerrarContrasena(): void;
}

/**
 * `ROLES_ASIGNABLES`, not `ROLES`: an existing `operador` still renders with its own label
 * in the table below, but the form no longer creates one. See the header of roles.ts.
 */
const OPCIONES_ROL = ROLES_ASIGNABLES.map((rol) => ({ valor: rol, label: ETIQUETAS_ROL[rol] }));

/**
 * The form opens on the role it will mostly create — the client supervising their sectors —
 * and not on the one that grants the whole application to whoever is created by mistake.
 */
const ROL_INICIAL: RolUsuario = 'encargado';

export function UsuariosScreen(p: Props) {
  const [nombre, setNombre] = useState(''); const [email, setEmail] = useState('');
  const [rol, setRol] = useState<RolUsuario>(ROL_INICIAL); const [sectores, setSectores] = useState<readonly string[]>([]);

  const problema = problemaDelAlta({ nombre, email, rol, sectores }, p.sectoresDisponibles);
  // A pristine form is not a wrong one: the reason appears once there is something to be
  // wrong about, so «Completá un nombre» does not greet somebody who has not typed yet.
  const empezado = nombre !== '' || email !== '' || rol !== ROL_INICIAL;

  const alternarSector = (sector: string, marcado: boolean) =>
    setSectores((previos) => (marcado ? [...previos, sector] : previos.filter((s) => s !== sector)));

  const crear = () => {
    if (problema !== null) return;
    p.onCrear({ nombre: nombre.trim(), email: email.trim(), rol, sectores: sectoresParaCrear(rol, sectores) });
    setNombre(''); setEmail(''); setRol(ROL_INICIAL); setSectores([]);
  };

  return <>
    {p.error && <div className="usuarios__aviso"><Alert tono="error">{p.error}</Alert></div>}
    {p.contrasenaTemporal && <div className="usuarios__aviso"><Alert tono="ok" titulo="Contraseña temporal">
      <div className="usuarios__temporal"><code>{p.contrasenaTemporal}</code>
        <Button tamano="sm" onClick={() => void navigator.clipboard.writeText(p.contrasenaTemporal!)}>Copiar</Button>
        <Button tamano="sm" variante="ghost" onClick={p.onCerrarContrasena}>Cerrar</Button></div>
      Compartila por un canal seguro. Se muestra sólo en esta pantalla.
    </Alert></div>}
    <Card titulo="Crear usuario" bajada="La contraseña se genera automáticamente y se muestra una sola vez. El rol y los sectores no se pueden cambiar después.">
      <div className="usuarios__alta">
        <Input etiqueta="Nombre" mostrarEtiqueta valor={nombre} onCambio={setNombre} maxLength={200} />
        <Input etiqueta="Correo" mostrarEtiqueta valor={email} onCambio={setEmail} type="email" maxLength={320} />
        <label className="usuarios__rol"><span>Rol</span><Select etiqueta="Rol" valor={rol} onCambio={(v) => { if (esRolAsignable(v)) setRol(v); }} opciones={OPCIONES_ROL} /></label>
        <Button variante="primary" disabled={problema !== null} onClick={crear}>Crear usuario</Button>
      </div>

      {rol === 'encargado' && <SectoresDelEncargado sectores={p.sectoresDisponibles} elegidos={sectores} onAlternar={alternarSector} />}

      {problema !== null && empezado && <p className="usuarios__problema" role="status">{problema}</p>}

      <p className="usuarios__nota">
        Un <strong>administrador</strong> ve toda la aplicación; un <strong>encargado</strong> sólo
        justifica las ausencias de los sectores que se le asignen acá.
      </p>
    </Card>
    <Card titulo="Usuarios" bajada="Desactivar revoca sus sesiones. Restablecer genera una contraseña nueva.">
      <Table etiqueta="Usuarios del sistema"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Sectores</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>{p.usuarios.length === 0 && <FilaVacia columnas={6}>{p.cargando ? 'Cargando…' : 'No hay usuarios.'}</FilaVacia>}
          {p.usuarios.map((u) => <tr key={u.id}><td>{u.nombre}</td><td className="tabla__mono">{u.email}</td><td>{ETIQUETAS_ROL[u.rol]}</td>
            <td>{u.sectores.length === 0 ? <span className="usuarios__sin-sectores">{u.rol === 'encargado' ? 'Sin sectores' : '—'}</span>
              : <span className="usuarios__sectores">{u.sectores.map((s) => <Chip key={s} tono="neutral">{s}</Chip>)}</span>}</td>
            <td><Chip tono={u.activo ? 'ok' : 'neutral'}>{u.activo ? 'Activo' : 'Inactivo'}</Chip></td><td><div className="usuarios__acciones">
            <Button tamano="sm" onClick={() => p.onReiniciar(u.id)}>Restablecer contraseña</Button>
            <Button tamano="sm" variante="ghost" disabled={u.email === p.usuarioActual && u.activo} onClick={() => p.onEstado(u.id, !u.activo)}>{u.activo ? 'Desactivar' : 'Activar'}</Button>
          </div></td></tr>)}</tbody></Table>
    </Card>
  </>;
}

/**
 * The sector picker: checkboxes, not a text field and not a second `<select multiple>`.
 *
 * A typed sector that does not match the `Sector` cell exactly scopes the account to
 * nothing, silently — the person logs in and sees an empty app. So when there is nothing to
 * tick, the form says why and stays blocked rather than accepting a name nobody can verify.
 */
function SectoresDelEncargado({
  sectores, elegidos, onAlternar,
}: {
  readonly sectores: readonly string[];
  readonly elegidos: readonly string[];
  readonly onAlternar: (sector: string, marcado: boolean) => void;
}) {
  return (
    <fieldset className="usuarios__sectores-campo">
      <legend>Sectores que supervisa</legend>
      {sectores.length === 0 ? (
        <p className="usuarios__nota">
          Todavía no hay sectores: salen de la columna «Sector» de las planillas cargadas.
          Cargá una y volvé a crear la cuenta.
        </p>
      ) : (
        <div className="usuarios__sectores-lista">
          {sectores.map((sector) => (
            <Checkbox key={sector} marcado={elegidos.includes(sector)} onCambio={(m) => onAlternar(sector, m)}>
              {sector}
            </Checkbox>
          ))}
        </div>
      )}
    </fieldset>
  );
}
