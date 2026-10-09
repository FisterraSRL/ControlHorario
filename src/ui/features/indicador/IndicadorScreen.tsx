/**
 * Presentational. How many faltas of each class every person of the period has, with the
 * period's own totals under them.
 *
 * This screen only reports: there is no checkbox, no button and nothing to download. The
 * column headings come from `META_FALTAS`, so they read exactly as the chips on the
 * Notificaciones screen and as the section titles of the Word document.
 *
 * «Total faltas» is every falta of the person in the period; «Notificadas» is how many of
 * those a generated Word already covered. A falta notified once and later erased by a rule
 * fix is not counted: the column only intersects with the faltas that exist now.
 */

import { Fragment, type ReactNode } from 'react';

import {
  META_FALTAS,
  ORDEN_FALTAS,
  totalDeFaltas,
  type NotificacionPersona,
} from '../../../notificaciones/index.js';
import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { FilaVacia, Table } from '../../components/molecules/Table/Table.js';
import type { NotificadasIndicador, TotalesIndicador } from './indicador.js';
import './indicador.css';

/** Persona, DNI, Total faltas and Notificadas, plus one column per falta class: seven today. */
const COLUMNAS = 4 + ORDEN_FALTAS.length;

interface Props {
  readonly filtros?: ReactNode;
  readonly sinCoincidencias?: boolean;
  readonly personas: readonly NotificacionPersona[];
  readonly totales: TotalesIndicador;
  readonly notificadas: NotificadasIndicador;
  readonly cargando: boolean;
  /** While the period's notified keys load, the column says so instead of a false zero. */
  readonly cargandoNotificadas: boolean;
  readonly errorNotificadas: string | null;
}

/** A count in its own cell. A zero is muted so a clean row does not shout as loudly. */
function Cuenta({ valor }: { readonly valor: number }) {
  const clase = valor === 0 ? 'tabla__mono indicador__numero indicador__numero--cero' : 'tabla__mono indicador__numero';
  return <td className={clase}>{valor}</td>;
}

/** The «Notificadas» cell: a count, or an ellipsis while it is not known yet. */
function CuentaNotificadas({ valor, cargando }: { readonly valor: number; readonly cargando: boolean }) {
  if (cargando) return <td className="tabla__mono indicador__numero indicador__numero--cero">…</td>;
  return <Cuenta valor={valor} />;
}

export function IndicadorScreen({
  filtros,
  sinCoincidencias,
  personas,
  totales,
  notificadas,
  cargando,
  cargandoNotificadas,
  errorNotificadas,
}: Props) {
  let sectorAnterior = '';

  return (
    <Card
      titulo="Indicador de notificaciones"
      bajada="Cantidad de faltas detectadas por persona en el período seleccionado y cuántas tienen un documento generado. Esto no confirma su entrega al empleado."
    >
      {errorNotificadas && (
        <div className="indicador__aviso">
          <Alert tono="aviso" titulo="No se pudo leer qué faltas tienen documento generado">
            {errorNotificadas}
          </Alert>
        </div>
      )}
      {filtros}
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
            <th className="indicador__numero">Total faltas</th>
            <th className="indicador__numero">Con documento generado</th>
          </tr>
        </thead>
        <tbody>
          {personas.length === 0 && (
            <FilaVacia columnas={COLUMNAS}>
              {cargando ? 'Calculando…' : sinCoincidencias ? 'No hay personas que coincidan con los filtros.' : 'Sin datos para este período.'}
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
                  <CuentaNotificadas
                    valor={notificadas.porDni.get(persona.dni) ?? 0}
                    cargando={cargandoNotificadas || !!errorNotificadas}
                  />
                </tr>
              </Fragment>
            );
          })}

          {/* The legacy's closing row. Hidden with an empty table, as there too: a line of
              zeros under "Sin datos para este período." would be noise, not information. */}
          {personas.length > 0 && (
            <tr className="tabla__grupo">
              <td>Total visible</td>
              <td />
              {ORDEN_FALTAS.map((tipo) => (
                <Cuenta key={tipo} valor={totales.porTipo[tipo]} />
              ))}
              <Cuenta valor={totales.total} />
              <CuentaNotificadas valor={notificadas.total} cargando={cargandoNotificadas || !!errorNotificadas} />
            </tr>
          )}
        </tbody>
      </Table>
    </Card>
  );
}
