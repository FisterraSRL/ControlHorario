/**
 * Presentational. Who has faltas in the period, and the three ways to turn that into a Word:
 * one letter for one person, one letter for one day of one person (from the row's detail),
 * or one file with everybody's ticked letter in it.
 *
 * The chips carry the same labels and the same three colours the letter is printed with
 * (`META_FALTAS`), so the screen and the document read as one thing rather than two.
 */

import { Fragment } from 'react';

import {
  META_FALTAS,
  ORDEN_FALTAS,
  totalDeFaltas,
  type FaltasPorTipo,
  type NotificacionPersona,
} from '../../../notificaciones/index.js';
import type { DiaConFaltas } from '../../faltas/porDia.js';
import { Button } from '../../components/atoms/Button/Button.js';
import { Checkbox } from '../../components/atoms/Checkbox/Checkbox.js';
import { Chip } from '../../components/atoms/Chip/Chip.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { FilaVacia, Table } from '../../components/molecules/Table/Table.js';
import { pluralizar } from '../../texto.js';
import './notificaciones.css';

/** Expand, Persona (with its checkbox), DNI, faltas, total, and the per-person button. */
const COLUMNAS = 6;

interface Props {
  readonly personas: readonly NotificacionPersona[];
  readonly seleccionadas: ReadonlySet<string>;
  /** The VISIBLE open rows, already intersected with `personas` by the container. */
  readonly abiertas: ReadonlySet<string>;
  /** Each open row's days, keyed by DNI. A row missing here simply lists nothing. */
  readonly dias: ReadonlyMap<string, readonly DiaConFaltas[]>;
  readonly cargando: boolean;
  readonly onAlternar: (dni: string) => void;
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
  cargando,
  onAlternar,
  onAlternarTodas,
  onAlternarDetalle,
  onGenerarPersona,
  onGenerarDia,
  onGenerarSeleccionadas,
}: Props) {
  // `Checkbox` has no indeterminate state, so "todas" is all or nothing, never a partial tick.
  const todas = personas.length > 0 && seleccionadas.size === personas.length;
  let sectorAnterior = '';

  return (
    <Card
      titulo="Notificaciones a generar"
      bajada="Fichadas incompletas, exceso de descanso y llegadas tarde del período, agrupadas por sector y persona. El Word se arma en esta misma pantalla."
      acciones={
        <Button variante="primary" onClick={onGenerarSeleccionadas} disabled={seleccionadas.size === 0}>
          Generar seleccionadas ({seleccionadas.size})
        </Button>
      }
    >
      <Table etiqueta="Personas con faltas en el período">
        <thead>
          <tr>
            <th>
              <span className="notificaciones__sr">Detalle por día</span>
            </th>
            <th>
              <Checkbox marcado={todas} onCambio={onAlternarTodas} disabled={personas.length === 0}>
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
                      marcado={seleccionadas.has(persona.dni)}
                      onCambio={() => onAlternar(persona.dni)}
                    >
                      {persona.usuario}
                    </Checkbox>
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
                      aria-label={`Generar el Word de ${persona.usuario}`}
                      onClick={() => onGenerarPersona(persona.dni)}
                    >
                      Generar Word
                    </Button>
                  </td>
                </tr>
                {abierta && (
                  <tr>
                    {/* Under the expand column, so the days line up with the person's name. */}
                    <td />
                    <td colSpan={COLUMNAS - 1}>
                      <ul className="notificaciones__dias" aria-label={`Días con faltas de ${persona.usuario}`}>
                        {(dias.get(persona.dni) ?? []).map((dia) => (
                          <li key={dia.fecha} className="notificaciones__dia">
                            <span className="notificaciones__fecha">{dia.fecha}</span>
                            <ChipsDeFaltas faltasPorTipo={dia.persona.faltasPorTipo} />
                            <Button
                              variante="ghost"
                              tamano="sm"
                              aria-label={`Generar el Word de ${persona.usuario} del ${dia.fecha}`}
                              onClick={() => onGenerarDia(persona.dni, dia.fecha)}
                            >
                              Generar Word
                            </Button>
                          </li>
                        ))}
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
