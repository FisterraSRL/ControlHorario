/**
 * Counted nouns, in agreement.
 *
 * "1 filas descartadas" is the kind of thing that makes an operator distrust the rest of
 * the number. Spanish needs two forms and no more, so this is the whole of it.
 */
export function pluralizar(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
