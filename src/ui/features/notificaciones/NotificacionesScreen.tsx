/** Presentational selection of people and specific days to add to the shared queue.
 * Preparing never generates a document or changes notified marks.
 */
import { Fragment } from 'react';

import {
  META_FALTAS,
  ORDEN_FALTAS,
  totalDeFaltas,
  type FaltasPorTipo,
  type NotificacionPersona,
} from '../../../notificaciones/index.js';
import { contarNotificadas, type DiaConFaltas, type IdFaltaNotificada } from '../../faltas/porDia.js';
import { Button } from '../../components/atoms/Button/Button.js';
import { Checkbox } from '../../components/atoms/Checkbox/Checkbox.js';
import { Chip } from '../../components/atoms/Chip/Chip.js';
import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { FilaVacia, Table } from '../../components/molecules/Table/Table.js';
import { pluralizar } from '../../texto.js';
import { etiquetaNotificacion, type SeleccionDias } from './notificaciones.js';
import './notificaciones.css';

/** Expand, Persona (with its checkbox), DNI, faltas, total, and the per-person button. */
const COLUMNAS = 6;

interface Props {
  readonly personas: readonly NotificacionPersona[];
  readonly seleccionadas: SeleccionDias;
  /** The VISIBLE open rows, already intersected with `personas` by the container. */
  readonly abiertas: ReadonlySet<string>;
  /** The current period's days, keyed by DNI, including closed rows. */
  readonly dias: ReadonlyMap<string, readonly DiaConFaltas[]>;
  /** Notified keys of the period (`idFaltaNotificada`). */
  readonly notificadas: ReadonlySet<IdFaltaNotificada>;
  readonly cargando: boolean;
  /** A document's record is in flight: every generate button waits for it. */
  readonly registrando: boolean;
  /** Why the last document was not handed over, or why the notified state is unknown. */
  readonly error: string | null;
  readonly onAlternar: (dni: string) => void;
  readonly onAlternarDia: (dni: string, fecha: string) => void;
  readonly onAlternarTodas: (marcado: boolean) => void;
  readonly onAlternarDetalle: (dni: string) => void;
  readonly onGenerarPersona: (dni: string) => void;
  readonly onGenerarDia: (dni: string, fecha: string) => void;
  readonly onGenerarSeleccionadas: () => void;
}

/** One chip per kind of falta present, with its count. The Faltas column and every day use it. */
function ChipsDeFaltas({ faltasPorTipo }: { readonly faltasPorTipo: FaltasPorTipo }) {
  return (
    <div className="notificaciones__chips">
      {ORDEN_FALTAS.map((tipo) => {
        const cantidad = faltasPorTipo[tipo].length;
        if (cantidad === 0) return null;
        return (
          <Chip key={tipo} tono={tipo} title={META_FALTAS[tipo].label}>
            {META_FALTAS[tipo].label}: {cantidad}
          </Chip>
        );
      })}
    </div>
  );
}

export function NotificacionesScreen({
  personas,
  seleccionadas,
  abiertas,
  dias,
  notificadas,
  cargando,
  registrando,
  error,
  onAlternar,
  onAlternarDia,
  onAlternarTodas,
  onAlternarDetalle,
  onGenerarPersona,
  onGenerarDia,
  onGenerarSeleccionadas,
}: Props) {
  const todas = personas.length > 0 && personas.every(
    (persona) => (seleccionadas.get(persona.dni)?.size ?? 0) === (dias.get(persona.dni)?.length ?? 0),
  );
  let sectorAnterior = '';

  return (
    <Card
      titulo="Preparar notificaciones"
      bajada="Fichadas incompletas, exceso de descanso y llegadas tarde del período, agrupadas por sector y persona. Agregá los documentos a Documentos preparados para revisarlos y generarlos juntos. Prepararlos no genera el Word ni acredita su entrega."
      acciones={
        <Button
          variante="primary"
          onClick={onGenerarSeleccionadas}
          disabled={seleccionadas.size === 0 || registrando}
        >
          Agregar seleccionadas al panel ({seleccionadas.size})
        </Button>
      }
    >
      <p className="notificaciones__ayuda">
        El detalle permite seleccionar días específicos, incluso no consecutivos. Agregar
        seleccionadas incluye sólo esos días en una carta por persona.
      </p>
      {error && (
        <div className="notificaciones__aviso">
          <Alert tono="error">{error}</Alert>
        </div>
      )}
      <Table etiqueta="Personas con faltas en el período">
        <thead>
          <tr>
            <th>
              <span className="notificaciones__sr">Detalle por día</span>
            </th>
            <th>
              <Checkbox
                marcado={todas}
                indeterminado={!todas && seleccionadas.size > 0}
                onCambio={onAlternarTodas}
                disabled={personas.length === 0}
              >
                Persona
              </Checkbox>
            </th>
            <th>DNI</th>
            <th>Faltas</th>
            <th>Total</th>
            <th>Notificación</th>
          </tr>
        </thead>
        <tbody>
          {personas.length === 0 && (
            <FilaVacia columnas={COLUMNAS}>
              {cargando ? 'Calculando…' : 'Sin faltas para este período.'}
            </FilaVacia>
          )}

          {personas.map((persona) => {
            const mostrarSector = sectorAnterior !== persona.sector;
            sectorAnterior = persona.sector;
            const total = totalDeFaltas(persona.faltasPorTipo);
            const abierta = abiertas.has(persona.dni);
            const diasPersona = dias.get(persona.dni) ?? [];
            const fechasSeleccionadas = seleccionadas.get(persona.dni);
            const cantidadSeleccionada = fechasSeleccionadas?.size ?? 0;
            const personaCompleta = diasPersona.length > 0 && cantidadSeleccionada === diasPersona.length;

            return (
              <Fragment key={persona.dni}>
                {mostrarSector && (
                  <tr className="tabla__grupo">
                    <td colSpan={COLUMNAS}>{persona.sector || 'Sin sector'}</td>
                  </tr>
                )}
                <tr>
                  <td>
                    <Button
                      tamano="sm"
                      variante="ghost"
                      aria-expanded={abierta}
                      aria-label={`${abierta ? 'Ocultar' : 'Ver'} los días con faltas de ${persona.usuario}`}
                      onClick={() => onAlternarDetalle(persona.dni)}
                    >
                      {abierta ? '−' : '+'}
                    </Button>
                  </td>
                  <td>
                    <Checkbox
                      marcado={personaCompleta}
                      indeterminado={cantidadSeleccionada > 0 && !personaCompleta}
                      onCambio={() => onAlternar(persona.dni)}
                    >
                      {persona.usuario}
                    </Checkbox>
                    {cantidadSeleccionada > 0 && (
                      <div className="notificaciones__seleccion">
                        {cantidadSeleccionada} de {diasPersona.length} días seleccionados
                      </div>
                    )}
                  </td>
                  <td className="tabla__mono">{persona.dni}</td>
                  <td>
                    <ChipsDeFaltas faltasPorTipo={persona.faltasPorTipo} />
                  </td>
                  <td className="notificaciones__total">{pluralizar(total, 'falta', 'faltas')}</td>
                  <td>
                    <Button
                      variante="ghost"
                      tamano="sm"
                      aria-label={`Preparar documento de ${persona.usuario} con ${cantidadSeleccionada} días seleccionados`}
                      disabled={registrando || cantidadSeleccionada === 0}
                      onClick={() => onGenerarPersona(persona.dni)}
                    >
                      {cantidadSeleccionada === 0 ? 'Seleccioná días' : personaCompleta ? `Agregar todos (${cantidadSeleccionada} días)` : `Agregar ${cantidadSeleccionada} día(s)`}
                    </Button>
                  </td>
                </tr>
                {abierta && (
                  <tr>
                    {/* Under the expand column, so the days line up with the person's name. */}
                    <td />
                    <td colSpan={COLUMNAS - 1}>
                      <ul className="notificaciones__dias" aria-label={`Días con faltas de ${persona.usuario}`}>
                        {diasPersona.map((dia) => {
                          const cuenta = contarNotificadas(dia.persona, notificadas);
                          const estado = etiquetaNotificacion(cuenta);
                          return (
                            <li key={dia.fecha} className="notificaciones__dia">
                              <span className="notificaciones__fecha">
                                <Checkbox
                                  marcado={fechasSeleccionadas?.has(dia.fecha) ?? false}
                                  onCambio={() => onAlternarDia(persona.dni, dia.fecha)}
                                >
                                  {dia.fecha}
                                </Checkbox>
                              </span>
                              <ChipsDeFaltas faltasPorTipo={dia.persona.faltasPorTipo} />
                              {estado && (
                                <Chip tono={cuenta.notificadas >= cuenta.total ? 'ok' : 'neutral'}>
                                  {estado}
                                </Chip>
                              )}
                              <Button
                                variante="ghost"
                                tamano="sm"
                                aria-label={`Preparar documento de ${persona.usuario} del ${dia.fecha}`}
                                disabled={registrando}
                                onClick={() => onGenerarDia(persona.dni, dia.fecha)}
                              >
                                Agregar día al panel
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}
