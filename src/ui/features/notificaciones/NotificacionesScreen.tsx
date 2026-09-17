/**
 * Presentational. Who has faltas in the period, and the two ways to turn that into a Word:
 * one letter for one person, or one file with everybody's ticked letter in it.
 *
 * The chips carry the same labels and the same three colours the letter is printed with
 * (`META_FALTAS`), so the screen and the document read as one thing rather than two.
 */

import { Fragment } from 'react';

import {
  META_FALTAS,
  ORDEN_FALTAS,
  totalDeFaltas,
  type NotificacionPersona,
} from '../../../notificaciones/index.js';
import { Button } from '../../components/atoms/Button/Button.js';
import { Checkbox } from '../../components/atoms/Checkbox/Checkbox.js';
import { Chip } from '../../components/atoms/Chip/Chip.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { FilaVacia, Table } from '../../components/molecules/Table/Table.js';
import { pluralizar } from '../../texto.js';
import './notificaciones.css';

/** Persona (with its checkbox), DNI, faltas, total, and the per-person button. */
const COLUMNAS = 5;

interface Props {
  readonly personas: readonly NotificacionPersona[];
  readonly seleccionadas: ReadonlySet<string>;
  readonly cargando: boolean;
  readonly onAlternar: (dni: string) => void;
  readonly onAlternarTodas: (marcado: boolean) => void;
  readonly onGenerarPersona: (dni: string) => void;
  readonly onGenerarSeleccionadas: () => void;
}

export function NotificacionesScreen({
  personas,
  seleccionadas,
  cargando,
  onAlternar,
  onAlternarTodas,
  onGenerarPersona,
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

            return (
              <Fragment key={persona.dni}>
                {mostrarSector && (
                  <tr className="tabla__grupo">
                    <td colSpan={COLUMNAS}>{persona.sector || 'Sin sector'}</td>
                  </tr>
                )}
                <tr>
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
                    <div className="notificaciones__chips">
                      {ORDEN_FALTAS.map((tipo) => {
                        const cantidad = persona.faltasPorTipo[tipo].length;
                        if (cantidad === 0) return null;
                        return (
                          <Chip key={tipo} tono={tipo} title={META_FALTAS[tipo].label}>
                            {META_FALTAS[tipo].label}: {cantidad}
                          </Chip>
                        );
                      })}
                    </div>
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
              </Fragment>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}
