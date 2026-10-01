import { Fragment } from 'react';
import { fmtFechaAR, fmtMinutos, type Motivo, type RegistroDia, type SemanaEmpleado } from '../../../domain/fichadas/index.js';
import { opcionesMotivo, type OpcionMotivo } from '../../ausencias/opcionesMotivo.js';
import { Button } from '../../components/atoms/Button/Button.js';
import { Chip } from '../../components/atoms/Chip/Chip.js';
import { Select } from '../../components/atoms/Select/Select.js';
import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { FilaVacia, Table } from '../../components/molecules/Table/Table.js';
import { pluralizar } from '../../texto.js';
import { claveSemana, lineaFichadas, rangoSemana } from './horas.js';
import './horas.css';

type OnMotivo = (dni: string, fechaStr: string, motivoId: number | null) => void;

interface Props {
  readonly semanas: readonly SemanaEmpleado[]; readonly motivos: readonly Motivo[]; readonly cargando: boolean;
  /** The VISIBLE open rows, already intersected with `semanas` by the container. */
  readonly abiertas: ReadonlySet<string>; readonly todasAbiertas: boolean;
  readonly onAlternar: (clave: string) => void; readonly onAlternarTodas: (abrir: boolean) => void;
  readonly onMotivo: OnMotivo; readonly error: string | null; readonly aviso: string | null; readonly onExportar: () => void;
  /** Why a hand-picked range's edge weeks read short; `null` when they are whole. */
  readonly semanasParciales: string | null;
}

export function HorasScreen({ semanas, motivos, cargando, abiertas, todasAbiertas, onAlternar, onAlternarTodas, onMotivo, error, aviso, onExportar, semanasParciales }: Props) {
  const pendientes = semanas.reduce((n, s) => n + s.diasAusenciaSinClasificar, 0); let sectorAnterior = '';
  const opciones = opcionesMotivo(motivos);
  return <>
    {error && <div className="horas__aviso"><Alert tono="error" titulo="Algo no se pudo hacer">{error}</Alert></div>}
    {aviso && <div className="horas__aviso"><Alert tono="ok">{aviso}</Alert></div>}
    {semanasParciales && <div className="horas__aviso"><Alert tono="info" titulo="Semanas incompletas">{semanasParciales}</Alert></div>}
    {pendientes > 0 && <div className="horas__aviso"><Alert tono="aviso" titulo={`${pluralizar(pendientes, 'día pendiente', 'días pendientes')} de clasificación`}>Clasificalos desplegando la semana o desde la pestaña Ausencias para incorporar las horas justificadas al cálculo.</Alert></div>}
    <Card titulo="Horas trabajadas (semanal, lunes a domingo)" bajada="Comparación entre horas de turno, horas trabajadas, descansos y ausencias justificadas." acciones={<>
      <Button variante="ghost" onClick={() => onAlternarTodas(!todasAbiertas)} disabled={semanas.length === 0}>{todasAbiertas ? 'Contraer todas' : 'Desplegar todas'}</Button>
      <Button onClick={onExportar} disabled={semanas.length === 0}>Exportar a Excel</Button>
    </>}>
      <Table etiqueta="Reporte semanal de horas trabajadas"><thead><tr><th><span className="horas__sr">Detalle</span></th><th>Persona</th><th>DNI</th><th>Semana</th><th>Turno</th><th>Trabajadas</th><th>Descanso</th><th>Diferencia</th></tr></thead><tbody>
        {semanas.length === 0 && <FilaVacia columnas={8}>{cargando ? 'Calculando…' : 'Sin datos para este período.'}</FilaVacia>}
        {semanas.map((semana) => { const clave = claveSemana(semana); const abierta = abiertas.has(clave); const mostrarSector = sectorAnterior !== semana.sector; sectorAnterior = semana.sector; return <Fragment key={clave}>
          {mostrarSector && <tr className="tabla__grupo"><td colSpan={8}>{semana.sector || 'Sin sector'}</td></tr>}
          <tr><td><Button tamano="sm" variante="ghost" aria-expanded={abierta} aria-label={`${abierta ? 'Ocultar' : 'Mostrar'} detalle de ${semana.usuario}`} onClick={() => onAlternar(clave)}>{abierta ? '−' : '+'}</Button></td>
            <td>{semana.usuario}{semana.diasAusenciaSinClasificar > 0 && <> <Chip tono="incompleta">{semana.diasAusenciaSinClasificar} sin clasif.</Chip></>}</td><td className="tabla__mono">{semana.dni}</td><td className="tabla__mono">{rangoSemana(semana.inicioSemana)}</td>
            <td className="tabla__mono">{fmtMinutos(semana.horasTurno)}</td><td className="tabla__mono">{fmtMinutos(semana.horasTrabajadas + semana.horasJustificadas)}</td><td className="tabla__mono">{fmtMinutos(semana.horasDescanso)}</td><td className={`tabla__mono ${semana.diferencia >= 0 ? 'horas__positiva' : 'horas__negativa'}`}>{semana.diferencia >= 0 ? '+' : ''}{fmtMinutos(semana.diferencia)}</td></tr>
          {abierta && <tr><td /><td colSpan={7}><DetalleSemana dias={semana.dias} opciones={opciones} onMotivo={onMotivo} /></td></tr>}
        </Fragment>; })}
      </tbody></Table>
    </Card>
  </>;
}

/**
 * One line per day. Only an absence is editable: its motivo is the one decision a human takes
 * over a day, and it goes through the same write Ausencias uses, so the week's totals and its
 * "sin clasif." chip are re-derived upstream rather than patched here.
 */
function DetalleSemana({ dias, opciones, onMotivo }: { readonly dias: readonly RegistroDia[]; readonly opciones: readonly OpcionMotivo[]; readonly onMotivo: OnMotivo }) {
  return <div className="horas__dias">{[...dias].sort((a, b) => (a.fecha?.getTime() ?? 0) - (b.fecha?.getTime() ?? 0)).map((dia) => {
    const fecha = fmtFechaAR(dia.fecha) || dia.fechaStr; const fichadas = lineaFichadas(dia);
    let estado = 'Correcto'; let tono: 'ok' | 'neutral' | 'incompleta' = 'ok';
    if (dia.tipoDia === 'libre') { estado = 'Franco'; tono = 'neutral'; }
    else if (dia.faltas.length) { estado = dia.faltas.map((f) => f.detalle).join(' · '); tono = 'incompleta'; }
    return <div className="horas__dia" key={`${dia.dni}|${dia.fechaStr}`}>
      <div className="horas__dia-cabecera"><span><b>{fecha}</b> · {dia.turnoRaw || 'Sin turno'}</span>
        {dia.tipoDia === 'ausencia'
          // A motivo QUICKPASS's note implied shows as selected, as in Ausencias; picking any
          // value turns it into a human decision.
          ? <Select etiqueta={`Motivo de ${dia.usuario || dia.dni} el ${fecha}`} tamano="sm" valor={dia.motivoId === null ? '' : String(dia.motivoId)} opciones={opciones} onCambio={(valor) => onMotivo(dia.dni, dia.fechaStr, valor === '' ? null : Number(valor))} />
          : <Chip tono={tono}>{estado}</Chip>}
      </div>
      {fichadas && <div className="horas__movimientos">{fichadas}</div>}
    </div>;
  })}</div>;
}
