/**
 * Shapes of the fichadas domain.
 *
 * The vocabulary is Spanish on purpose: `fichada`, `ausencia`, `motivo`, `legajo`, `turno`,
 * `parte`, `descanso` and `tardanza` are the words the business and the QUICKPASS export
 * itself use. Translating them would create a second vocabulary nobody speaks. Comments are
 * in English; identifiers are not.
 *
 * Legacy field mapping (legacy/app.html, ~lines 536-652) — same values, Spanish names:
 *   movCount -> cantidadMovimientos   movArr      -> movimientos
 *   isDayOff -> esDiaLibre            isFlexible  -> esFlexible
 *   turnoStart -> inicioTurno         turnoRaw    -> turnoRaw
 *   required -> fichadasRequeridas    horasGross  -> horasBrutas
 *   weekStart -> inicioSemana         dayType     -> tipoDia
 *   faults -> faltas                  excluded    -> excluido
 *   partesRaw -> partesRaw            fault.detail -> falta.detalle
 * The string *values* (`libre` / `ausencia` / `trabajo`, `incompleta` / `descanso` /
 * `tardanza`) are unchanged — they are already Spanish and they reach the notifications.
 */

/** A cell of the QUICKPASS sheet as the xlsx reader hands it over. */
export type ValorCelda = string | number | null | undefined;

/**
 * One raw row of a QUICKPASS export, addressed by its original Spanish column headers:
 * `Sector`, `Usuario`, `DNI`, `Legajo`, `Fecha`, `Movimientos`, `Turno`, `Horas Turno`,
 * `Horas`, `Cantidad Tarde`, `Partes`. Kept as an open record because the export carries
 * extra columns that are stored verbatim as evidence and never interpreted here.
 */
export interface FilaQuickpass {
  readonly [columna: string]: ValorCelda;
}

/** A day is either a franco/día libre, an absence, or a worked day. */
export type TipoDia = 'libre' | 'ausencia' | 'trabajo';

/**
 * The three irregularities the engine derives. Faults are ALWAYS derived from the evidence
 * and never stored — that is what lets a rule fix retroactively correct the whole history.
 */
export type TipoFalta = 'incompleta' | 'descanso' | 'tardanza';

/** Who decided the motivo of an absence. RRHH ('manual') outranks a manager ('encargado'). */
export type OrigenMotivo = 'partes' | 'manual' | 'encargado';

export interface Falta {
  readonly tipo: TipoFalta;
  /** Human-readable text that reaches the Word notification. Spanish, verbatim. */
  readonly detalle: string;
  /** Only meaningful on `incompleta`: QUICKPASS's own Partes note reported a forgotten punch. */
  readonly olvidoFichar?: boolean;
}

/** A motivo de ausencia. `worked` decides whether the day still counts as hours worked. */
export interface Motivo {
  readonly id: number;
  readonly label: string;
  readonly worked: boolean;
}

/** A human decision already taken over a (dni, fecha), keyed as `${dni}|${fechaStr}`. */
export interface AusenciaRegistrada {
  readonly motivoId?: number | null;
  readonly motivoSource?: OrigenMotivo;
}

/** Parsed `Turno` column. `inicio` is minutes past midnight, or null when there is none. */
export interface InfoTurno {
  readonly esDiaLibre: boolean;
  readonly esFlexible: boolean;
  readonly inicio: number | null;
}

/**
 * Engine configuration. Every field is optional and falls back to the legacy default, so a
 * bare `{}` reproduces the original behaviour exactly.
 */
export interface ConfiguracionFichadas {
  /** Fichadas required per day, by sector. Anything missing (or 0) means 4. */
  readonly reglasSector?: Readonly<Record<string, number>>;
  /** DNIs excluded from disciplinary notifications. Their hours still count. */
  readonly dniExcluidos?: readonly string[];
  /** Closed list of motivos. Defaults to `MOTIVOS_POR_DEFECTO`. */
  readonly motivos?: readonly Motivo[];
  /** Absences already resolved by a human, keyed `${dni}|${fechaStr}`. */
  readonly ausencias?: Readonly<Record<string, AusenciaRegistrada>>;
  /** Maximum break in minutes before a `descanso` fault. Default 30. */
  readonly descansoMaxMin?: number;
  /** Lateness tolerated in minutes before a `tardanza` fault. Default 0. */
  readonly toleranciaMin?: number;
  /** Contractual weekly hours, a single global value for everyone. Default 51. */
  readonly horasTurnoSemanales?: number;
}

/** The full derived record of one person on one day. */
export interface RegistroDia {
  readonly sector: string;
  readonly usuario: string;
  readonly dni: string;
  readonly legajo: string;
  /** Parsed date, always UTC midnight. Null when `Fecha` was unparseable. */
  readonly fecha: Date | null;
  /** The original `Fecha` cell, verbatim — it is the key of the human-decision tables. */
  readonly fechaStr: string;
  /** Monday of this date as `YYYY-MM-DD`, or null when there is no date. */
  readonly inicioSemana: string | null;
  readonly cantidadMovimientos: number;
  /** Punch times, minutes past midnight, in sheet order. */
  readonly movimientos: readonly number[];
  readonly turnoRaw: string;
  readonly esDiaLibre: boolean;
  readonly esFlexible: boolean;
  readonly inicioTurno: number | null;
  readonly fichadasRequeridas: number;
  /** Contractual minutes of the shift, from the `Horas Turno` column. */
  readonly horasTurno: number;
  /** Minutes actually on the clock, from the `Horas` column. */
  readonly horasBrutas: number;
  readonly cantidadTarde: number;
  readonly partesRaw: string;
  /** Real break in minutes: only computed when 4 fichadas are required and 3+ were made. */
  readonly descansoReal: number;
  readonly faltas: readonly Falta[];
  readonly tipoDia: TipoDia | null;
  readonly motivoId: number | null;
  readonly motivoSource: OrigenMotivo | null;
  readonly excluido: boolean;
}

/** One person's week, as the Horas Trabajadas report shows it. */
export interface SemanaEmpleado {
  readonly dni: string;
  readonly usuario: string;
  readonly legajo: string;
  /** The most frequent sector across the week's days. */
  readonly sector: string;
  readonly inicioSemana: string;
  /** Contractual weekly minutes — the same global value for everyone. */
  readonly horasTurno: number;
  readonly horasTrabajadas: number;
  readonly horasDescanso: number;
  /** Minutes of absence that a `worked: true` motivo justifies. */
  readonly horasJustificadas: number;
  /** horasTrabajadas + horasJustificadas - horasTurno. Negative means owed hours. */
  readonly diferencia: number;
  readonly diasAusenciaSinClasificar: number;
  readonly dias: readonly RegistroDia[];
}
