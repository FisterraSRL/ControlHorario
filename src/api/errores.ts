/** Safe classification of Azure SQL errors. Row values and SQL text never enter logs. */

export const NUMERO_SQL = {
  claveForaneaOCheck: 547,
  claveDuplicada: 2601,
  restriccionUnica: 2627,
  objetoInexistente: 208,
} as const;

interface ErrorSqlParcial {
  readonly code?: unknown;
  readonly number?: unknown;
  readonly state?: unknown;
  readonly class?: unknown;
  readonly lineNumber?: unknown;
  readonly procName?: unknown;
}

function comoCadena(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor !== '' ? valor : undefined;
}

function comoNumero(valor: unknown): number | undefined {
  return typeof valor === 'number' && Number.isInteger(valor) ? valor : undefined;
}

export function numeroSql(e: unknown): number | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  return comoNumero((e as ErrorSqlParcial).number);
}

function esErrorSql(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const parcial = e as ErrorSqlParcial;
  return numeroSql(e) !== undefined || comoCadena(parcial.code)?.startsWith('E') === true;
}

export function errorDbParaLog(e: unknown): Record<string, string | number> {
  const seguro: Record<string, string | number> = { tipo: 'error_base_de_datos' };
  if (typeof e !== 'object' || e === null) {
    seguro['clase'] = typeof e;
    return seguro;
  }
  const sql = e as ErrorSqlParcial;
  const code = comoCadena(sql.code);
  const number = comoNumero(sql.number);
  const state = comoNumero(sql.state);
  const severity = comoNumero(sql.class);
  const line = comoNumero(sql.lineNumber);
  const procedure = comoCadena(sql.procName);
  if (code) seguro['codigo'] = code;
  if (number !== undefined) seguro['numero'] = number;
  if (state !== undefined) seguro['estado'] = state;
  if (severity !== undefined) seguro['severidad'] = severity;
  if (line !== undefined) seguro['linea'] = line;
  if (procedure) seguro['procedimiento'] = procedure;
  if (!code && number === undefined) seguro['clase'] = e instanceof Error ? e.name : 'desconocido';
  return seguro;
}

export function errorParaLog(e: unknown): Record<string, unknown> {
  if (esErrorSql(e)) return errorDbParaLog(e);
  if (!(e instanceof Error)) return { tipo: 'error_no_error', clase: typeof e };
  return { tipo: 'error', clase: e.name, mensaje: e.message, stack: e.stack };
}
