/**
 * Turning a database failure into something safe to log and safe to return.
 *
 * This matters more here than in most apps. `pg` errors carry a `detail` field, and on a
 * constraint violation Postgres fills it with the offending values:
 *
 *     detail: 'Key (dni, fecha)=(<el DNI de la persona>, 2026-01-05) already exists.'
 *
 * A DNI is personal data. `where` can carry the body of the plpgsql trigger, `internalQuery`
 * the statement text. If the error object reaches pino as-is, every one of those lands in
 * the log file, which is then copied around as "the logs" by whoever is debugging. So the
 * error never travels: only its class does.
 *
 * The same reasoning applies to the HTTP response. A 500 says a 500 and nothing else.
 */

/** Postgres error codes this API reacts to by name rather than by string matching. */
export const CODIGO_PG = {
  /** 23503 — a referenced row is missing. */
  claveForanea: '23503',
  /** 23505 — unique violation. */
  claveDuplicada: '23505',
  /** 23514 — a CHECK failed. */
  restriccionCheck: '23514',
  /** 42P01 — relation does not exist: the migrations were never applied. */
  tablaInexistente: '42P01',
} as const;

interface ErrorPgParcial {
  readonly code?: unknown;
  readonly severity?: unknown;
  readonly routine?: unknown;
  readonly constraint?: unknown;
  readonly table?: unknown;
  readonly schema?: unknown;
}

function comoCadena(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor !== '' ? valor : undefined;
}

/** The Postgres SQLSTATE of an error, when it is one. */
export function codigoPg(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  return comoCadena((e as ErrorPgParcial).code);
}

/**
 * The only shape of a database error that is allowed into a log line.
 *
 * Structural fields only — code, constraint, table, routine. Every field that can quote a
 * row value (`detail`, `where`, `internalQuery`, `hint`) and the message itself are dropped:
 * Postgres interpolates values into the message too ('duplicate key value violates ...' is
 * safe, but a RAISE EXCEPTION in `ausencias_rrhh_gana()` prints the dni and the fecha).
 */
export function errorDbParaLog(e: unknown): Record<string, string> {
  const seguro: Record<string, string> = { tipo: 'error_base_de_datos' };
  if (typeof e !== 'object' || e === null) {
    seguro['clase'] = typeof e;
    return seguro;
  }
  const pg = e as ErrorPgParcial;
  const code = comoCadena(pg.code);
  if (code) seguro['sqlstate'] = code;
  const constraint = comoCadena(pg.constraint);
  if (constraint) seguro['restriccion'] = constraint;
  const table = comoCadena(pg.table);
  if (table) seguro['tabla'] = table;
  const routine = comoCadena(pg.routine);
  if (routine) seguro['rutina'] = routine;
  if (!code) seguro['clase'] = e instanceof Error ? e.name : 'desconocido';
  return seguro;
}

/**
 * A non-database error, reduced to its name and stack. The message is kept only for errors
 * this codebase raises itself, which never contain row data; anything else keeps its class.
 */
export function errorParaLog(e: unknown): Record<string, unknown> {
  if (codigoPg(e) !== undefined) return errorDbParaLog(e);
  if (!(e instanceof Error)) return { tipo: 'error_no_error', clase: typeof e };
  return { tipo: 'error', clase: e.name, mensaje: e.message, stack: e.stack };
}
