import { useState } from 'react';

import type { Motivo } from '../../../domain/fichadas/index.js';
import { Button } from '../../components/atoms/Button/Button.js';
import { Checkbox } from '../../components/atoms/Checkbox/Checkbox.js';
import { Chip } from '../../components/atoms/Chip/Chip.js';
import { Input } from '../../components/atoms/Input/Input.js';
import { Select } from '../../components/atoms/Select/Select.js';
import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { SegmentedControl } from '../../components/molecules/SegmentedControl/SegmentedControl.js';
import { FilaVacia, Table } from '../../components/molecules/Table/Table.js';
import type { ParametrosConfiguracion } from '../../configuracion/RepositorioConfiguracion.js';
import type { FilaExclusion, FilaSector, OpcionPersona } from './configuracion.js';
import './configuracion.css';

export interface ConfiguracionScreenProps {
  readonly cargando: boolean;
  readonly error: string | null;
  readonly parametros: ParametrosConfiguracion | null;
  readonly sectores: readonly FilaSector[];
  readonly motivos: readonly Motivo[];
  readonly exclusiones: readonly FilaExclusion[];
  readonly excluibles: readonly OpcionPersona[];
  readonly permiteCambiarContrasena: boolean;
  readonly onCambiarContrasena: (actual: string, nueva: string) => Promise<void>;
  readonly onSector: (sector: string, fichadasRequeridas: number) => void;
  readonly onParametro: (campo: keyof ParametrosConfiguracion, valor: number) => void;
  readonly onMotivoWorked: (id: number, worked: boolean) => void;
  readonly onMotivoNuevo: (label: string, worked: boolean) => void;
  readonly onMotivoRetirar: (id: number) => void;
  readonly onExcluir: (dni: string) => void;
  readonly onIncluir: (dni: string) => void;
}

/** Presentational: props in, markup out. No repository, no fetch, no domain logic. */
export function ConfiguracionScreen({
  cargando,
  error,
  parametros,
  sectores,
  motivos,
  exclusiones,
  excluibles,
  permiteCambiarContrasena,
  onCambiarContrasena,
  onSector,
  onParametro,
  onMotivoWorked,
  onMotivoNuevo,
  onMotivoRetirar,
  onExcluir,
  onIncluir,
}: ConfiguracionScreenProps) {
  return (
    <>
      {error && (
        <div className="config__aviso">
          <Alert tono="error" titulo="No se pudo guardar el cambio">
            {error}
          </Alert>
        </div>
      )}

      {permiteCambiarContrasena && (
        <SeccionContrasena onCambiar={onCambiarContrasena} />
      )}

      <SeccionSectores cargando={cargando} sectores={sectores} onSector={onSector} />
      <SeccionParametros parametros={parametros} onParametro={onParametro} />
      <SeccionExclusiones
        exclusiones={exclusiones}
        excluibles={excluibles}
        onExcluir={onExcluir}
        onIncluir={onIncluir}
      />
      <SeccionMotivos
        motivos={motivos}
        onMotivoWorked={onMotivoWorked}
        onMotivoNuevo={onMotivoNuevo}
        onMotivoRetirar={onMotivoRetirar}
      />
    </>
  );
}

function SeccionContrasena({
  onCambiar,
}: {
  readonly onCambiar: (actual: string, nueva: string) => Promise<void>;
}) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<{ tono: 'error' | 'ok'; mensaje: string } | null>(null);

  const guardar = async (): Promise<void> => {
    if (nueva.length < 12) {
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
      <div className="config__contrasena">
        <Input etiqueta="Contraseña actual" mostrarEtiqueta type="password" autoComplete="current-password" valor={actual} onCambio={setActual} maxLength={200} />
        <Input etiqueta="Contraseña nueva" mostrarEtiqueta type="password" autoComplete="new-password" valor={nueva} onCambio={setNueva} minLength={12} maxLength={200} />
        <Input etiqueta="Repetir contraseña nueva" mostrarEtiqueta type="password" autoComplete="new-password" valor={confirmacion} onCambio={setConfirmacion} minLength={12} maxLength={200} />
        <Button variante="primary" disabled={guardando || !actual || !nueva || !confirmacion} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Cambiar contraseña'}</Button>
      </div>
      {resultado && <div className="config__aviso config__aviso--interno"><Alert tono={resultado.tono}>{resultado.mensaje}</Alert></div>}
    </Card>
  );
}

const OPCIONES_FICHADAS = [
  { valor: '2', label: '2 fichadas' },
  { valor: '4', label: '4 fichadas' },
] as const;

function SeccionSectores({
  cargando,
  sectores,
  onSector,
}: {
  readonly cargando: boolean;
  readonly sectores: readonly FilaSector[];
  readonly onSector: (sector: string, fichadasRequeridas: number) => void;
}) {
  return (
    <Card
      titulo="Fichadas por sector"
      bajada="Cuántas fichadas se esperan por día en cada sector: dos (entrada y salida) o cuatro (con la salida y el reingreso del descanso). Un sector sin regla pide cuatro."
    >
      {cargando && <p className="config__vacio">Leyendo la configuración…</p>}

      {!cargando && sectores.length === 0 && (
        <p className="config__vacio">Cargá una planilla para ver los sectores.</p>
      )}

      <div className="config__sectores">
        {sectores.map((fila) => (
          <div key={fila.sector} className="config__sector">
            <span className="config__sector-nombre">
              {fila.sector}
              {!fila.enElHistorial && (
                <>
                  {' '}
                  <Chip tono="neutral" title="Ya no aparece en el historial cargado">
                    sin datos
                  </Chip>
                </>
              )}
            </span>
            <SegmentedControl
              etiqueta={`Fichadas requeridas en ${fila.sector}`}
              opciones={[...OPCIONES_FICHADAS]}
              valor={String(fila.fichadasRequeridas)}
              onCambio={(valor) => onSector(fila.sector, Number(valor))}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

interface CampoParametro {
  readonly campo: keyof ParametrosConfiguracion;
  readonly etiqueta: string;
  readonly ayuda: string;
  readonly maximo: number;
  readonly paso: string;
}

const CAMPOS: readonly CampoParametro[] = [
  {
    campo: 'horasTurnoSemanales',
    etiqueta: 'Horas de turno por semana',
    ayuda: 'Las horas contractuales, iguales para todos. El legacy lo llamaba horasTurnoFixed.',
    maximo: 168,
    paso: '0.5',
  },
  {
    campo: 'descansoMaxMin',
    etiqueta: 'Descanso máximo (minutos)',
    ayuda: 'Pasado este tiempo entre la salida y el reingreso, el día genera una falta de descanso.',
    maximo: 24 * 60,
    paso: '1',
  },
  {
    campo: 'toleranciaMin',
    etiqueta: 'Tolerancia de tardanza (minutos)',
    ayuda: 'Minutos de demora que no generan una tardanza. Cero es tolerancia nula.',
    maximo: 24 * 60,
    paso: '1',
  },
];

function SeccionParametros({
  parametros,
  onParametro,
}: {
  readonly parametros: ParametrosConfiguracion | null;
  readonly onParametro: (campo: keyof ParametrosConfiguracion, valor: number) => void;
}) {
  return (
    <Card
      titulo="Parámetros"
      bajada="Los tres umbrales con los que el motor deriva las faltas. Cambiarlos vuelve a calcular todo el historial: las faltas nunca se guardan, se derivan en cada lectura."
    >
      {!parametros ? (
        <p className="config__vacio">Leyendo la configuración…</p>
      ) : (
        <div className="config__parametros">
          {CAMPOS.map((campo) => (
            <CampoNumerico
              key={campo.campo}
              definicion={campo}
              valor={parametros[campo.campo]}
              onGuardar={(valor) => onParametro(campo.campo, valor)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * A number field that only writes when the value is valid and different.
 *
 * It keeps its own draft while it is being typed — a controlled field wired straight to the
 * server would fire a write per keystroke and fight the caret — and commits on blur or
 * Enter. An unparseable value never reaches the server and never silently becomes a
 * default, which is what the legacy `parseFloat(...) || 51` did.
 */
function CampoNumerico({
  definicion,
  valor,
  onGuardar,
}: {
  readonly definicion: CampoParametro;
  readonly valor: number;
  readonly onGuardar: (valor: number) => void;
}) {
  const [borrador, setBorrador] = useState<string | null>(null);
  const mostrado = borrador ?? String(valor);

  const confirmar = (): void => {
    if (borrador === null) return;
    const limpio = borrador.trim().replace(',', '.');
    const n = Number(limpio);
    setBorrador(null);
    if (limpio === '' || !Number.isFinite(n) || n < 0 || n > definicion.maximo) return;
    if (n !== valor) onGuardar(n);
  };

  return (
    <Input
      etiqueta={definicion.etiqueta}
      mostrarEtiqueta
      ayuda={definicion.ayuda}
      valor={mostrado}
      onCambio={setBorrador}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setBorrador(null);
      }}
      type="number"
      min={0}
      max={definicion.maximo}
      step={definicion.paso}
      inputMode="decimal"
    />
  );
}

function SeccionExclusiones({
  exclusiones,
  excluibles,
  onExcluir,
  onIncluir,
}: {
  readonly exclusiones: readonly FilaExclusion[];
  readonly excluibles: readonly OpcionPersona[];
  readonly onExcluir: (dni: string) => void;
  readonly onIncluir: (dni: string) => void;
}) {
  return (
    <Card
      titulo="Personas excluidas de las notificaciones"
      bajada="Sus horas siguen contando en el informe de horas trabajadas; simplemente nunca aparecen en una notificación disciplinaria. La lista se guarda por DNI y el nombre se toma del historial."
    >
      <div className="config__alta">
        <Select
          etiqueta="Agregar una persona a la lista de excluidos"
          valor=""
          opciones={[
            { valor: '', label: excluibles.length ? 'Agregar persona…' : 'No hay a quién agregar' },
            ...excluibles,
          ]}
          disabled={excluibles.length === 0}
          onCambio={(dni) => {
            if (dni) onExcluir(dni);
          }}
        />
      </div>

      {exclusiones.length === 0 ? (
        <p className="config__vacio">No hay personas excluidas.</p>
      ) : (
        <ul className="config__etiquetas">
          {exclusiones.map((fila) => (
            <li key={fila.dni} className="config__etiqueta">
              <span>{fila.nombre}</span>
              <span className="config__etiqueta-dni">{fila.dni}</span>
              <Button
                tamano="sm"
                variante="ghost"
                onClick={() => onIncluir(fila.dni)}
                aria-label={`Quitar a ${fila.nombre} de la lista de excluidos`}
              >
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SeccionMotivos({
  motivos,
  onMotivoWorked,
  onMotivoNuevo,
  onMotivoRetirar,
}: {
  readonly motivos: readonly Motivo[];
  readonly onMotivoWorked: (id: number, worked: boolean) => void;
  readonly onMotivoNuevo: (label: string, worked: boolean) => void;
  readonly onMotivoRetirar: (id: number) => void;
}) {
  const [label, setLabel] = useState('');
  const [worked, setWorked] = useState(false);
  const [avisoLocal, setAvisoLocal] = useState<string | null>(null);

  const agregar = (): void => {
    const limpio = label.trim();
    if (limpio === '') {
      setAvisoLocal('Escribí una etiqueta para el motivo antes de agregarlo.');
      return;
    }
    setAvisoLocal(null);
    onMotivoNuevo(limpio, worked);
    setLabel('');
    setWorked(false);
  };

  return (
    <Card
      titulo="Motivos de ausencia"
      bajada="La lista cerrada de motivos. «Cuenta como trabajado» decide si un día ausente con ese motivo sigue sumando horas en el informe."
    >
      <Table etiqueta="Motivos de ausencia">
        <thead>
          <tr>
            <th>ID</th>
            <th>Motivo</th>
            <th>Cuenta como trabajado</th>
            <th>
              <span className="config__sr">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {motivos.length === 0 && <FilaVacia columnas={4}>No hay motivos cargados.</FilaVacia>}
          {motivos.map((motivo) => (
            <tr key={motivo.id}>
              <td className="tabla__mono">{motivo.id}</td>
              <td>{motivo.label}</td>
              <td>
                <Button
                  tamano="sm"
                  aria-pressed={motivo.worked}
                  onClick={() => onMotivoWorked(motivo.id, !motivo.worked)}
                >
                  {motivo.worked ? 'Sí' : 'No'}
                </Button>
              </td>
              <td>
                <Button
                  tamano="sm"
                  variante="ghost"
                  onClick={() => onMotivoRetirar(motivo.id)}
                  aria-label={`Retirar el motivo ${motivo.label}`}
                >
                  Retirar
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      <p className="config__nota">
        Retirar un motivo lo saca de la lista para elegir, pero no borra nada: los días que ya
        fueron clasificados con él siguen diciendo lo mismo.
      </p>

      <div className="config__alta config__alta--motivo">
        <Input
          etiqueta="Nuevo motivo"
          mostrarEtiqueta
          valor={label}
          onCambio={setLabel}
          maxLength={80}
          placeholder="Por ejemplo: Trámite gremial"
          onKeyDown={(e) => {
            if (e.key === 'Enter') agregar();
          }}
        />
        <Checkbox marcado={worked} onCambio={setWorked}>
          Cuenta como trabajado
        </Checkbox>
        <Button variante="primary" onClick={agregar}>
          Agregar motivo
        </Button>
      </div>

      {avisoLocal && (
        <div className="config__aviso">
          <Alert tono="aviso">{avisoLocal}</Alert>
        </div>
      )}
    </Card>
  );
}
