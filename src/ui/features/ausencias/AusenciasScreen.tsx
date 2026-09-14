import { Fragment } from 'react';

import type { Motivo } from '../../../domain/fichadas/index.js';
import type { Adjunto } from '../../adjuntos/RepositorioAdjuntos.js';
import { Button } from '../../components/atoms/Button/Button.js';
import { Checkbox } from '../../components/atoms/Checkbox/Checkbox.js';
import { Chip } from '../../components/atoms/Chip/Chip.js';
import { Select } from '../../components/atoms/Select/Select.js';
import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { FilaVacia, Table } from '../../components/molecules/Table/Table.js';
import { pluralizar } from '../../texto.js';
import { etiquetaFecha, type FiltroAusencias, type VistaAusencias } from './ausencias.js';
import { PanelAdjuntos } from './PanelAdjuntos.js';
import './ausencias.css';

const COLUMNAS = 8;

export interface AusenciasScreenProps {
  readonly vista: VistaAusencias;
  readonly filtro: FiltroAusencias;
  readonly onFiltro: (filtro: FiltroAusencias) => void;
  readonly motivos: readonly Motivo[];
  /** Which rows have their attachment panel open. Survives a re-render, as in the legacy. */
  readonly abiertas: ReadonlySet<string>;
  readonly onAlternar: (clave: string) => void;
  readonly onMotivo: (dni: string, fechaStr: string, motivoId: number | null) => void;
  readonly adjuntosDisponibles: boolean;
  /** The row whose attachments are being written right now, or null. */
  readonly claveOcupada: string | null;
  readonly onSubir: (clave: string, dni: string, fechaStr: string, archivos: readonly File[]) => void;
  readonly onDescargar: (adjunto: Adjunto) => void;
  readonly onEliminar: (clave: string, adjunto: Adjunto) => void;
  readonly cargando: boolean;
  readonly error: string | null;
  readonly aviso: string | null;
}

/**
 * Presentational: everything it renders arrives as a prop. It does not read a repository,
 * does not import `src/domain` for anything but a type, and does not know a period exists —
 * `AusenciasContainer` does all three.
 *
 * The screen is a WORK QUEUE. "Mostrar solo las sin clasificar" is checked by default and
 * that is not a preference: an operator opens this to deal with the days nobody has dealt
 * with, and a list that started by showing four hundred already-resolved rows would bury
 * the twelve that need them.
 */
export function AusenciasScreen({
  vista,
  filtro,
  onFiltro,
  motivos,
  abiertas,
  onAlternar,
  onMotivo,
  adjuntosDisponibles,
  claveOcupada,
  onSubir,
  onDescargar,
  onEliminar,
  cargando,
  error,
  aviso,
}: AusenciasScreenProps) {
  const opcionesMotivo = [
    { valor: '', label: 'Sin clasificar' },
    ...motivos.map((m) => ({ valor: String(m.id), label: m.label })),
  ];

  let sectorAnterior: string | null = null;

  return (
    <Card
      titulo="Registro de ausencias"
      bajada="Cada día sin fichadas que el sistema detectó, con su motivo y su documentación de respaldo. El motivo que elijas acá queda como decisión de RRHH y una carga posterior no lo pisa."
    >
      <div className="ausencias__barra">
        <Select
          etiqueta="Filtrar por sector"
          tamano="sm"
          valor={filtro.sector}
          onCambio={(sector) => onFiltro({ ...filtro, sector })}
          opciones={[{ valor: '', label: 'Todos los sectores' }, ...vista.sectores]}
        />
        <Select
          etiqueta="Filtrar por persona"
          tamano="sm"
          valor={filtro.dni}
          onCambio={(dni) => onFiltro({ ...filtro, dni })}
          opciones={[{ valor: '', label: 'Todas las personas' }, ...vista.personas]}
        />
        <Checkbox
          marcado={filtro.soloPendientes}
          onCambio={(soloPendientes) => onFiltro({ ...filtro, soloPendientes })}
        >
          Mostrar solo las sin clasificar
        </Checkbox>

        <div className="ausencias__resumen">
          <Chip tono={vista.pendientes > 0 ? 'incompleta' : 'ok'}>
            <b>{vista.pendientes}</b>&nbsp;sin clasificar
          </Chip>
          <Chip tono="neutral">
            <b>{vista.total}</b>&nbsp;
            {vista.total === 1 ? 'ausencia' : 'ausencias'} en el período y filtro elegidos
          </Chip>
        </div>
      </div>

      {error && (
        <div className="ausencias__aviso">
          <Alert tono="error" titulo="Algo no se pudo hacer">
            {error}
          </Alert>
        </div>
      )}
      {aviso && (
        <div className="ausencias__aviso">
          <Alert tono="ok">{aviso}</Alert>
        </div>
      )}

      <Table etiqueta="Ausencias del período">
        <thead>
          <tr>
            <th>
              <span className="ausencias__sr">Adjuntos</span>
            </th>
            <th>Persona</th>
            <th>DNI</th>
            <th>Fecha</th>
            <th>Turno</th>
            <th>Nota QUICKPASS</th>
            <th>Motivo</th>
            <th>Adjuntos</th>
          </tr>
        </thead>
        <tbody>
          {cargando && (
            <FilaVacia columnas={COLUMNAS}>Leyendo el registro de ausencias…</FilaVacia>
          )}

          {!cargando && vista.filas.length === 0 && (
            <FilaVacia columnas={COLUMNAS}>
              {filtro.soloPendientes
                ? 'No hay ausencias sin clasificar con este filtro.'
                : 'No hay ausencias registradas con este filtro.'}
            </FilaVacia>
          )}

          {!cargando &&
            vista.filas.map((fila) => {
              const nuevoSector = fila.sector !== sectorAnterior;
              sectorAnterior = fila.sector;
              const abierta = abiertas.has(fila.clave);
              const pendiente = fila.motivoId === null;

              return (
                <Fragment key={fila.clave}>
                  {nuevoSector && (
                    <tr className="tabla__grupo">
                      <td colSpan={COLUMNAS}>{fila.sector || 'Sin sector'}</td>
                    </tr>
                  )}

                  <tr className={pendiente ? 'tabla__fila--pendiente' : undefined}>
                    <td>
                      <Button
                        tamano="sm"
                        variante="ghost"
                        aria-expanded={abierta}
                        onClick={() => onAlternar(fila.clave)}
                      >
                        <span aria-hidden="true">{abierta ? '−' : '+'}</span>
                        <span className="ausencias__sr">
                          {abierta ? 'Ocultar' : 'Ver'} adjuntos de {fila.usuario} el{' '}
                          {etiquetaFecha(fila)}
                        </span>
                      </Button>
                    </td>
                    <td>{fila.usuario || '—'}</td>
                    <td className="tabla__mono">{fila.dni}</td>
                    <td className="tabla__mono">{etiquetaFecha(fila)}</td>
                    <td className="tabla__mono">{fila.turnoRaw || '—'}</td>
                    <td className={fila.partesRaw ? undefined : 'tabla__tenue'}>
                      {fila.partesRaw || '—'}
                    </td>
                    <td>
                      <Select
                        etiqueta={`Motivo de ${fila.usuario || fila.dni} el ${etiquetaFecha(fila)}`}
                        tamano="sm"
                        valor={fila.motivoId === null ? '' : String(fila.motivoId)}
                        opciones={opcionesMotivo}
                        onCambio={(valor) =>
                          onMotivo(fila.dni, fila.fechaStr, valor === '' ? null : Number(valor))
                        }
                      />
                    </td>
                    <td>
                      {fila.adjuntos.length > 0 ? (
                        <Chip tono="neutral">{fila.adjuntos.length}</Chip>
                      ) : (
                        <span className="tabla__tenue">—</span>
                      )}
                    </td>
                  </tr>

                  {abierta && (
                    <tr>
                      <td />
                      <td colSpan={COLUMNAS - 1}>
                        <PanelAdjuntos
                          adjuntos={fila.adjuntos}
                          disponible={adjuntosDisponibles}
                          ocupado={claveOcupada === fila.clave}
                          onSubir={(archivos) =>
                            onSubir(fila.clave, fila.dni, fila.fechaStr, archivos)
                          }
                          onDescargar={onDescargar}
                          onEliminar={(adjunto) => onEliminar(fila.clave, adjunto)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
        </tbody>
      </Table>

      {!cargando && vista.total > 0 && filtro.soloPendientes && vista.pendientes === 0 && (
        <p className="ausencias__nota">
          Todo el período está clasificado. Destildá «Mostrar solo las sin clasificar» para ver
          las {pluralizar(vista.total, 'ausencia', 'ausencias')} del período.
        </p>
      )}
    </Card>
  );
}
