import { useState } from 'react';

import { Button } from '../../components/atoms/Button/Button.js';
import { Chip } from '../../components/atoms/Chip/Chip.js';
import { Input } from '../../components/atoms/Input/Input.js';
import { Select } from '../../components/atoms/Select/Select.js';
import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { FilaVacia, Table } from '../../components/molecules/Table/Table.js';
import type { RolUsuario, UsuarioAdministrado } from '../../usuarios/RepositorioUsuarios.js';
import './usuarios.css';

interface Props {
  usuarios: readonly UsuarioAdministrado[]; cargando: boolean; error: string | null;
  usuarioActual: string; contrasenaTemporal: string | null;
  onCrear(datos: { email: string; nombre: string; rol: RolUsuario }): void;
  onEstado(id: number, activo: boolean): void; onReiniciar(id: number): void; onCerrarContrasena(): void;
}

export function UsuariosScreen(p: Props) {
  const [nombre, setNombre] = useState(''); const [email, setEmail] = useState('');
  const [rol, setRol] = useState<RolUsuario>('operador'); const [aviso, setAviso] = useState<string | null>(null);
  const crear = () => {
    if (!nombre.trim() || !email.includes('@')) { setAviso('Completá un nombre y un correo válido.'); return; }
    setAviso(null); p.onCrear({ nombre: nombre.trim(), email: email.trim(), rol }); setNombre(''); setEmail(''); setRol('operador');
  };
  return <>
    {(p.error || aviso) && <div className="usuarios__aviso"><Alert tono="error">{p.error ?? aviso}</Alert></div>}
    {p.contrasenaTemporal && <div className="usuarios__aviso"><Alert tono="ok" titulo="Contraseña temporal">
      <div className="usuarios__temporal"><code>{p.contrasenaTemporal}</code>
        <Button tamano="sm" onClick={() => void navigator.clipboard.writeText(p.contrasenaTemporal!)}>Copiar</Button>
        <Button tamano="sm" variante="ghost" onClick={p.onCerrarContrasena}>Cerrar</Button></div>
      Compartila por un canal seguro. Se muestra sólo en esta pantalla.
    </Alert></div>}
    <Card titulo="Crear usuario" bajada="La contraseña se genera automáticamente y se muestra una sola vez.">
      <div className="usuarios__alta">
        <Input etiqueta="Nombre" mostrarEtiqueta valor={nombre} onCambio={setNombre} maxLength={200} />
        <Input etiqueta="Correo" mostrarEtiqueta valor={email} onCambio={setEmail} type="email" maxLength={320} />
        <label className="usuarios__rol"><span>Rol</span><Select etiqueta="Rol" valor={rol} onCambio={(v) => setRol(v as RolUsuario)} opciones={[{valor:'operador',label:'Operador'},{valor:'admin',label:'Administrador'}]} /></label>
        <Button variante="primary" onClick={crear}>Crear usuario</Button>
      </div>
    </Card>
    <Card titulo="Usuarios" bajada="Desactivar revoca sus sesiones. Restablecer genera una contraseña nueva.">
      <Table etiqueta="Usuarios del sistema"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>{p.usuarios.length === 0 && <FilaVacia columnas={5}>{p.cargando ? 'Cargando…' : 'No hay usuarios.'}</FilaVacia>}
          {p.usuarios.map((u) => <tr key={u.id}><td>{u.nombre}</td><td className="tabla__mono">{u.email}</td><td>{u.rol === 'admin' ? 'Administrador' : 'Operador'}</td><td><Chip tono={u.activo ? 'ok' : 'neutral'}>{u.activo ? 'Activo' : 'Inactivo'}</Chip></td><td><div className="usuarios__acciones">
            <Button tamano="sm" onClick={() => p.onReiniciar(u.id)}>Restablecer contraseña</Button>
            <Button tamano="sm" variante="ghost" disabled={u.email === p.usuarioActual && u.activo} onClick={() => p.onEstado(u.id, !u.activo)}>{u.activo ? 'Desactivar' : 'Activar'}</Button>
          </div></td></tr>)}</tbody></Table>
    </Card>
  </>;
}
