import { useId, useState } from 'react';

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
import { CAMPOS_PARAMETROS, parametrosModificados, type CampoParametro, type EstadoEditorParametros } from './editorParametros.js';
import type { FilaExclusion, FilaSector, OpcionPersona } from './configuracion.js';
import './configuracion.css';

export interface ConfiguracionScreenProps {
  readonly cargando: boolean;
  readonly error: string | null;
  readonly estadoParametros: EstadoEditorParametros;
  readonly sectores: readonly FilaSector[];
  readonly motivos: readonly Motivo[];
  readonly exclusiones: readonly FilaExclusion[];
  readonly excluibles: readonly OpcionPersona[];
  readonly onSector: (sector: string, fichadasRequeridas: number) => void;
  readonly onParametro: (campo: CampoParametro, valor: string) => void;
  readonly onGuardarParametros: () => void;
  readonly onCancelarParametros: () => void;
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
  estadoParametros,
  sectores,
  motivos,
  exclusiones,
  excluibles,
  onSector,
  onParametro,
  onGuardarParametros,
  onCancelarParametros,
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
          <Alert tono="error" titulo={estadoParametros.guardados ? "No se pudo guardar el cambio" : "No se pudo leer la configuración"}>
            {error}
          </Alert>
        </div>
      )}

      {/* «Mi contraseña» used to be here. It lives in features/micuenta now: it is not an
          administrative setting, and every role needs it — including the ones that never
          get to open this screen. */}
      <SeccionSectores cargando={cargando} sectores={sectores} onSector={onSector} />
      <SeccionParametros
        estado={estadoParametros}
        cargando={cargando}
        onParametro={onParametro}
        onGuardar={onGuardarParametros}
        onCancelar={onCancelarParametros}
      />
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

function SeccionParametros({
  estado,
  cargando,
  onParametro,
  onGuardar,
  onCancelar,
}: {
  readonly estado: EstadoEditorParametros;
  readonly cargando: boolean;
  readonly onParametro: (campo: CampoParametro, valor: string) => void;
  readonly onGuardar: () => void;
  readonly onCancelar: () => void;
}) {
  const id = useId();
  const modificado = parametrosModificados(estado);
  return (
    <Card
      titulo="Parámetros"
      bajada="Estos cuatro valores definen las faltas y las horas. Los cambios se aplican al historial sólo al guardar. Guardar y Cancelar corresponden a esta sección."
    >
      {!estado.borrador ? (
        <p className="config__vacio">
          {cargando ? 'Leyendo la configuración…' : 'No se pudieron cargar los parámetros. Recargá la página para volver a intentarlo.'}
        </p>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            onGuardar();
          }}
        >
          <div className="config__parametros">
            {CAMPOS_PARAMETROS.map((campo) => {
              const error = estado.errores[campo.campo];
              const ayudaId = `${id}-${campo.campo}-ayuda`;
              const errorId = `${id}-${campo.campo}-error`;
              return (
                <div key={campo.campo}>
                  <Input
                    etiqueta={campo.etiqueta}
                    mostrarEtiqueta
                    valor={estado.borrador![campo.campo]}
                    onCambio={(valor) => onParametro(campo.campo, valor)}
                    disabled={estado.guardando}
                    type="text"
                    inputMode={campo.entero ? 'numeric' : 'decimal'}
                    aria-invalid={!!error}
                    aria-describedby={error ? `${ayudaId} ${errorId}` : ayudaId}
                  />
                  <p id={ayudaId} className="config__ayuda">{campo.ayuda}</p>
                  {error && <p id={errorId} className="config__error-campo" role="alert">{error}</p>}
                </div>
              );
            })}
          </div>
          <div className="config__acciones-parametros" aria-busy={estado.guardando}>
            <Button type="submit" variante="primary" disabled={!modificado || estado.guardando}>
              {estado.guardando ? 'Guardando…' : 'Guardar'}
            </Button>
            <Button onClick={onCancelar} disabled={!modificado || estado.guardando}>Cancelar</Button>
            <span className="config__vacio" role="status">
              {estado.guardando ? 'Esperá a que termine el guardado.' : modificado ? 'Cambios sin guardar.' : 'Sin cambios pendientes.'}
            </span>
          </div>
          {estado.aviso && (
            <div className="config__resultado-parametros">
              <Alert tono={estado.aviso.tono}>{estado.aviso.texto}</Alert>
            </div>
          )}
        </form>
      )}
    </Card>
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
        Para recuperar un motivo retirado, agregalo de nuevo con el mismo nombre.
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
