/**
 * Request validation.
 *
 * Everything that arrives with a body is described here and rejected before it reaches a
 * query. Two AJV defaults have to be turned off for that to be true, and they are turned
 * off in `servidor.ts` where the instance is built:
 *
 *   * `removeAdditional` — Fastify's default is `true`, which does not reject an unexpected
 *     property, it *deletes* it and lets the request through. On an evidentiary upload that
 *     is the worst of both worlds: the operator is told the load succeeded and the row that
 *     landed is not the row they sent.
 *
 *   * `coerceTypes` — Fastify's default is `'array'`. It would turn a lone value into a
 *     one-element array and rewrite numbers into strings on its way past. The payload is
 *     evidence; nothing may rewrite a cell between the browser and `jsonb`.
 *
 * The row schema is deliberately open on property *names* — the QUICKPASS export carries
 * columns this app does not read and stores them verbatim — and closed on property *values*.
 * A cell is a string, a number or null. It is never an object or an array, so a nested
 * structure never reaches `jsonb`.
 */

/** ~55.000 rows is a year of QUICKPASS for 200 people. Ten times that is a mistake. */
const MAX_FILAS = 500_000;

/** The export has 11 columns the engine reads; 200 leaves room for anything QUICKPASS adds. */
const MAX_COLUMNAS = 200;

const FILA_QUICKPASS = {
  type: 'object',
  maxProperties: MAX_COLUMNAS,
  propertyNames: { type: 'string', minLength: 1, maxLength: 200 },
  additionalProperties: {
    type: ['string', 'number', 'null'],
    maxLength: 4_000,
  },
} as const;

export const ESQUEMA_CUERPO_UPSERT = {
  type: 'object',
  required: ['filas'],
  additionalProperties: false,
  properties: {
    filas: {
      type: 'array',
      maxItems: MAX_FILAS,
      items: FILA_QUICKPASS,
    },
  },
} as const;
