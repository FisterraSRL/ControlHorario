/**
 * Presentational. How many faltas of each class every person of the period has, with the
 * period's own totals under them.
 *
 * This screen only reports: there is no checkbox, no button and nothing to download. The
 * column headings come from `META_FALTAS`, so they read exactly as the chips on the
 * Notificaciones screen and as the section titles of the Word document.
 */

import { Fragment } from 'react';

import {
  META_FALTAS,
  ORDEN_FALTAS,
  totalDeFaltas,
  type NotificacionPersona,
} from '../../../notificaciones/index.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { FilaVacia, Table } from '../../components/molecules/Table/Table.js';
import type { TotalesIndicador } from './indicador.js';
import './indicador.css';

/** Persona, DNI and Total, plus one column per falta class: six today. */
const COLUMNAS = 3 + ORDEN_FALTAS.length;

interface Props {
  readonly personas: readonly NotificacionPersona[];
  readonly totales: TotalesIndicador;
  readonly cargando: boolean;
}

/** A count in its own cell. A zero is muted so a clean row does not shout as loudly. */
function Cuenta({ valor }: { readonly valor: number }) {
  const clase = valor === 0 ? 'tabla__mono indicador__numero indicador__numero--cero' : 'tabla__mono indicador__numero';
  return <td className={clase}>{valor}</td>;
}

export function IndicadorScreen({ personas, totales, cargando }: Props) {
  let sectorAnterior = '';

  return (
    <Card
      titulo="Indicador de notificaciones"
      bajada="Cantidad de faltas detectadas por persona en el período seleccionado."
    >
      <Table etiqueta="Faltas por persona en el período">
        <thead>
          <tr>
            <th>Persona</th>
            <th>DNI</th>
            {ORDEN_FALTAS.map((tipo) => (
              <th key={tipo} className="indicador__numero">
                {META_FALTAS[tipo].label}
              </th>
            ))}
            <th className="indicador__numero">Total</th>
          </tr>
        </thead>
        <tbody>
          {personas.length === 0 && (
            <FilaVacia columnas={COLUMNAS}>
              {cargando ? 'Calculando…' : 'Sin datos para este período.'}
            </FilaVacia>
          )}

          {personas.map((persona) => {
            const mostrarSector = sectorAnterior !== persona.sector;
            sectorAnterior = persona.sector;

            return (
              <Fragment key={persona.dni}>
                {mostrarSector && (
                  <tr className="tabla__grupo">
                    <td colSpan={COLUMNAS}>{persona.sector || 'Sin sector'}</td>
                  </tr>
                )}
                <tr>
                  <td>{persona.usuario}</td>
                  <td className="tabla__mono">{persona.dni}</td>
                  {ORDEN_FALTAS.map((tipo) => (
                    <Cuenta key={tipo} valor={persona.faltasPorTipo[tipo].length} />
                  ))}
                  <Cuenta valor={totalDeFaltas(persona.faltasPorTipo)} />
                </tr>
              </Fragment>
            );
          })}

          {/* The legacy's closing row. Hidden with an empty table, as there too: a line of
              zeros under "Sin datos para este período." would be noise, not information. */}
          {personas.length > 0 && (
            <tr className="tabla__grupo">
              <td>Total período</td>
              <td />
              {ORDEN_FALTAS.map((tipo) => (
                <Cuenta key={tipo} valor={totales.porTipo[tipo]} />
              ))}
              <Cuenta valor={totales.total} />
            </tr>
          )}
        </tbody>
      </Table>
    </Card>
  );
}
