import { Fragment } from 'react';
import { fmtFechaAR, fmtMinutos, fmtReloj, MOTIVOS_POR_DEFECTO, type Motivo, type RegistroDia, type SemanaEmpleado } from '../../../domain/fichadas/index.js';
import { Button } from '../../components/atoms/Button/Button.js';
import { Chip } from '../../components/atoms/Chip/Chip.js';
import { Alert } from '../../components/molecules/Alert/Alert.js';
import { Card } from '../../components/molecules/Card/Card.js';
import { FilaVacia, Table } from '../../components/molecules/Table/Table.js';
import { pluralizar } from '../../texto.js';
import { rangoSemana } from './horas.js';
import './horas.css';

interface Props { readonly semanas: readonly SemanaEmpleado[]; readonly motivos: readonly Motivo[]; readonly cargando: boolean; readonly abiertas: ReadonlySet<string>; readonly onAlternar: (clave: string) => void; readonly onExportar: () => void; }

export function HorasScreen({ semanas, motivos, cargando, abiertas, onAlternar, onExportar }: Props) {
  const pendientes = semanas.reduce((n, s) => n + s.diasAusenciaSinClasificar, 0); let sectorAnterior = '';
  return <>
    {pendientes > 0 && <div className="horas__aviso"><Alert tono="aviso" titulo={`${pluralizar(pendientes, 'día pendiente', 'días pendientes')} de clasificación`}>Clasificalos desde la pestaña Ausencias para incorporar las horas justificadas al cálculo.</Alert></div>}
    <Card titulo="Horas trabajadas (semanal, lunes a domingo)" bajada="Comparación entre horas de turno, horas trabajadas, descansos y ausencias justificadas." acciones={<Button onClick={onExportar} disabled={semanas.length === 0}>Exportar a Excel</Button>}>
      <Table etiqueta="Reporte semanal de horas trabajadas"><thead><tr><th><span className="horas__sr">Detalle</span></th><th>Persona</th><th>DNI</th><th>Semana</th><th>Turno</th><th>Trabajadas</th><th>Descanso</th><th>Diferencia</th></tr></thead><tbody>
        {semanas.length === 0 && <FilaVacia columnas={8}>{cargando ? 'Calculando…' : 'Sin datos para este período.'}</FilaVacia>}
        {semanas.map((semana) => { const clave = `${semana.dni}|${semana.inicioSemana}`; const abierta = abiertas.has(clave); const mostrarSector = sectorAnterior !== semana.sector; sectorAnterior = semana.sector; return <Fragment key={clave}>
          {mostrarSector && <tr className="tabla__grupo"><td colSpan={8}>{semana.sector || 'Sin sector'}</td></tr>}
          <tr><td><Button tamano="sm" variante="ghost" aria-expanded={abierta} aria-label={`${abierta ? 'Ocultar' : 'Mostrar'} detalle de ${semana.usuario}`} onClick={() => onAlternar(clave)}>{abierta ? '−' : '+'}</Button></td>
            <td>{semana.usuario}{semana.diasAusenciaSinClasificar > 0 && <> <Chip tono="incompleta">{semana.diasAusenciaSinClasificar} sin clasif.</Chip></>}</td><td className="tabla__mono">{semana.dni}</td><td className="tabla__mono">{rangoSemana(semana.inicioSemana)}</td>
            <td className="tabla__mono">{fmtMinutos(semana.horasTurno)}</td><td className="tabla__mono">{fmtMinutos(semana.horasTrabajadas + semana.horasJustificadas)}</td><td className="tabla__mono">{fmtMinutos(semana.horasDescanso)}</td><td className={`tabla__mono ${semana.diferencia >= 0 ? 'horas__positiva' : 'horas__negativa'}`}>{semana.diferencia >= 0 ? '+' : ''}{fmtMinutos(semana.diferencia)}</td></tr>
          {abierta && <tr><td /><td colSpan={7}><DetalleSemana dias={semana.dias} motivos={motivos} /></td></tr>}
        </Fragment>; })}
      </tbody></Table>
    </Card>
  </>;
}

function DetalleSemana({ dias, motivos }: { readonly dias: readonly RegistroDia[]; readonly motivos: readonly Motivo[] }) {
  const indice = new Map((motivos.length ? motivos : MOTIVOS_POR_DEFECTO).map((m) => [m.id, m]));
  return <div className="horas__dias">{[...dias].sort((a, b) => (a.fecha?.getTime() ?? 0) - (b.fecha?.getTime() ?? 0)).map((dia) => {
    let estado = 'Correcto'; let tono: 'ok' | 'neutral' | 'incompleta' = 'ok';
    if (dia.tipoDia === 'libre') { estado = 'Franco'; tono = 'neutral'; }
    else if (dia.tipoDia === 'ausencia') { const motivo = dia.motivoId ? indice.get(dia.motivoId) : null; estado = motivo?.label ?? 'Sin clasificar'; tono = motivo ? (motivo.worked ? 'ok' : 'neutral') : 'incompleta'; }
    else if (dia.faltas.length) { estado = dia.faltas.map((f) => f.detalle).join(' · '); tono = 'incompleta'; }
    return <div className="horas__dia" key={`${dia.dni}|${dia.fechaStr}`}><div><b>{fmtFechaAR(dia.fecha)}</b> · {dia.turnoRaw || 'Sin turno'} <Chip tono={tono}>{estado}</Chip></div>{dia.tipoDia === 'trabajo' && <div className="horas__movimientos">{dia.movimientos.length ? dia.movimientos.map(fmtReloj).join(' · ') : 'Sin fichadas'} · {fmtMinutos(dia.horasBrutas)} trabajadas</div>}</div>;
  })}</div>;
}
