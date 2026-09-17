import { domingoDe, fmtFechaAR, fmtMinutos, reporteSemanal, type ConfiguracionFichadas, type RegistroDia, type SemanaEmpleado } from '../../../domain/fichadas/index.js';
import { dentroDelPeriodo, type RangoPeriodo } from '../../periodo/periodo.js';

export function construirReporteHoras(registros: readonly RegistroDia[], configuracion: ConfiguracionFichadas, rango: RangoPeriodo): readonly SemanaEmpleado[] {
  return reporteSemanal(registros.filter((r) => dentroDelPeriodo(r.fecha, rango)), configuracion);
}

export function rangoSemana(inicioSemana: string): string {
  const inicio = new Date(`${inicioSemana}T00:00:00Z`);
  return `${fmtFechaAR(inicio)} – ${fmtFechaAR(domingoDe(inicio))}`;
}

function campoCsv(valor: string | number): string {
  const texto = String(valor);
  return /["\r\n;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Semicolon + BOM is what Excel in an es-AR locale opens into columns without a wizard. */
export function csvDeHoras(semanas: readonly SemanaEmpleado[]): string {
  const filas: readonly (readonly (string | number)[])[] = [
    ['Sector', 'Persona', 'DNI', 'Legajo', 'Semana desde', 'Semana hasta', 'Horas Turno', 'Horas Trabajadas', 'Horas Descanso', 'Diferencia', 'Días sin clasificar'],
    ...semanas.map((s) => {
      const inicio = new Date(`${s.inicioSemana}T00:00:00Z`);
      return [s.sector, s.usuario, s.dni, s.legajo, fmtFechaAR(inicio), fmtFechaAR(domingoDe(inicio)), fmtMinutos(s.horasTurno), fmtMinutos(s.horasTrabajadas + s.horasJustificadas), fmtMinutos(s.horasDescanso), `${s.diferencia >= 0 ? '+' : ''}${fmtMinutos(s.diferencia)}`, s.diasAusenciaSinClasificar];
    }),
  ];
  return `\ufeff${filas.map((fila) => fila.map(campoCsv).join(';')).join('\r\n')}`;
}
