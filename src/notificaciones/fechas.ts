/**
 * The long Spanish date the notification is headed with.
 *
 * Legacy: `fechaLarga` (legacy/app.html ~line 1871).
 */

/**
 * Month names as they are printed. Lowercase is correct Spanish orthography and is what
 * the legacy emits; it reaches the employee's letter verbatim.
 */
export const MESES: readonly string[] = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/**
 * `12 de marzo de 2026`.
 *
 * Read in UTC, not local time, exactly as the legacy did. That matters: the fichadas
 * engine parses every `Fecha` cell to UTC midnight, so reading the date back in UTC is
 * what keeps a day from sliding to the previous one west of Greenwich — Argentina is
 * UTC-3, so `getDate()` would print the day before for any UTC-midnight date.
 *
 * An invalid Date yields `NaN de undefined de NaN`. That is the legacy's behaviour and it
 * is kept: the module does not decide what a document with an unparseable date should say.
 */
export function fechaLarga(d: Date): string {
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}
