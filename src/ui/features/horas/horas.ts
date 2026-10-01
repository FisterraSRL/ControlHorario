import { domingoDe, fmtFechaAR, fmtMinutos, fmtReloj, reporteSemanal, type ConfiguracionFichadas, type RegistroDia, type SemanaEmpleado } from '../../../domain/fichadas/index.js';
import { dentroDelPeriodo, semanasParciales, type Periodo, type RangoPeriodo } from '../../periodo/periodo.js';

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

/** A row of the report is one person's week; this is its key, and the expand state's. */
export function claveSemana(semana: Pick<SemanaEmpleado, 'dni' | 'inicioSemana'>): string {
  return `${semana.dni}|${semana.inicioSemana}`;
}

/**
 * The rows that are open AS THE SCREEN SEES THEM: the container's raw set intersected with
 * the rows on screen. A period change does not clear the raw set, so a key from another
 * period may still be in it; derived here, it can neither show as open nor keep "Contraer
 * todas" on screen for rows nobody can see.
 */
export function abiertasVisibles(abiertas: ReadonlySet<string>, semanas: readonly SemanaEmpleado[]): ReadonlySet<string> {
  return new Set(semanas.map(claveSemana).filter((clave) => abiertas.has(clave)));
}

/** True only when there is something on screen and all of it is open. */
export function todasAbiertas(visibles: ReadonlySet<string>, semanas: readonly SemanaEmpleado[]): boolean {
  return semanas.length > 0 && semanas.every((s) => visibles.has(claveSemana(s)));
}

/**
 * The next state after toggling one row. It starts from the VISIBLE set, not the raw one, so
 * the first click after a period change also drops the keys of rows that are gone.
 */
export function alternarSemana(visibles: ReadonlySet<string>, clave: string): ReadonlySet<string> {
  const siguiente = new Set(visibles);
  if (siguiente.has(clave)) siguiente.delete(clave);
  else siguiente.add(clave);
  return siguiente;
}

/** "Desplegar todas" opens exactly the rows on screen; "Contraer todas" closes everything. */
export function desplegarTodas(semanas: readonly SemanaEmpleado[], abrir: boolean): ReadonlySet<string> {
  return abrir ? new Set(semanas.map(claveSemana)) : new Set();
}

/**
 * The day's punches as one compact line, for the nested detail row.
 *
 * An absence is by definition a day with no punches, so its line says so and carries the
 * QUICKPASS note instead: that note is what the operator classifies from, and it is the
 * same text Ausencias shows in its own column. A franco nobody punched on gets no line at
 * all — "Sin fichadas" there would read as something wrong when nothing is.
 */
export function lineaFichadas(dia: RegistroDia): string | null {
  if (dia.movimientos.length > 0) return `${dia.movimientos.map(fmtReloj).join(' · ')} · ${fmtMinutos(dia.horasBrutas)} trabajadas`;
  if (dia.tipoDia === 'libre') return null;
  const nota = dia.partesRaw.trim();
  return nota ? `Sin fichadas · Nota QUICKPASS: ${nota}` : 'Sin fichadas';
}

/**
 * The notice for a period whose window cuts a Monday–Sunday week short — a hand-picked range,
 * but also a month or a single day. The calculation is NOT adjusted: `reporteSemanal`
 * compares every week against the full weekly turno, and a pro-rated turno would be a payroll
 * decision, not a display one. This only says so.
 */
export function avisoSemanasParciales(periodo: Periodo): string | null {
  const parciales = semanasParciales(periodo);
  if (!parciales) return null;
  const consecuencia = 'su «Diferencia» se compara contra el turno semanal completo.';
  if (parciales.unica) return `El período no cubre la semana entera de lunes a domingo: ${consecuencia}`;
  if (parciales.primera && parciales.ultima) return `La primera y la última semana del período están incompletas: ${consecuencia}`;
  return `La ${parciales.primera ? 'primera' : 'última'} semana del período está incompleta: ${consecuencia}`;
}
