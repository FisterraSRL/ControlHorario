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

/**
 * Login.
 *
 * `maxLength` on both fields, and it matters more than it looks: without it, argon2 would
 * be asked to hash whatever arrived, and a 5 MB "password" is 5 MB of memory-hard work per
 * request. The cap matches LARGO_MAXIMO_CONTRASENA in contrasenas.ts.
 *
 * No `format: 'email'` and no pattern. The validator's job here is to bound the input, not
 * to decide what a valid address looks like: a rejection shaped differently from a failed
 * login is one more way to find out whether an address is in the table.
 */
export const ESQUEMA_CUERPO_LOGIN = {
  type: 'object',
  required: ['email', 'contrasena'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 320 },
    contrasena: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;

/** `DD/MM/YYYY`, the raw QUICKPASS cell — the key the whole decision layer is written on. */
const FECHA_AR = { type: 'string', pattern: '^\\d{2}/\\d{2}/\\d{4}$' } as const;

/** A DNI as QUICKPASS prints it. Digits only is not safe to assume, so: short and printable. */
const DNI = { type: 'string', minLength: 1, maxLength: 32 } as const;

/**
 * Setting or clearing the motivo of one day.
 *
 * `motivoId: null` is the clear, and it is not the same as omitting the field — omitting it
 * would be a request that says nothing. `required` makes the difference explicit.
 *
 * The day travels here, in the body, and never in the path: see the header of
 * `rutasAusencias.ts` for why a DNI must not appear in a URL.
 */
export const ESQUEMA_CUERPO_MOTIVO_DIA = {
  type: 'object',
  required: ['dni', 'fecha', 'motivoId'],
  additionalProperties: false,
  properties: {
    dni: DNI,
    fecha: FECHA_AR,
    motivoId: { type: ['integer', 'null'], minimum: 1 },
  },
} as const;

/** One global parameter of `configuracion`. */
export const ESQUEMA_CUERPO_PARAMETROS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    descansoMaxMin: { type: 'integer', minimum: 0, maximum: 24 * 60 },
    toleranciaMin: { type: 'integer', minimum: 0, maximum: 24 * 60 },
    horasTurnoSemanales: { type: 'number', minimum: 0, maximum: 168 },
  },
} as const;

/** A new motivo, added from Configuración. The id is assigned by the server. */
export const ESQUEMA_CUERPO_MOTIVO_NUEVO = {
  type: 'object',
  required: ['label', 'worked'],
  additionalProperties: false,
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 80 },
    worked: { type: 'boolean' },
  },
} as const;

/** Editing an existing motivo. Only `worked` is editable, same as the legacy screen. */
export const ESQUEMA_CUERPO_MOTIVO_EDITADO = {
  type: 'object',
  required: ['worked'],
  additionalProperties: false,
  properties: { worked: { type: 'boolean' } },
} as const;

/** Putting somebody on the exclusion list. */
export const ESQUEMA_CUERPO_EXCLUSION = {
  type: 'object',
  required: ['dni'],
  additionalProperties: false,
  properties: {
    dni: DNI,
    motivoTexto: { type: 'string', maxLength: 400 },
  },
} as const;

/** Taking somebody off it. A body, not a path parameter, for the DNI-in-a-URL reason. */
export const ESQUEMA_CUERPO_BAJA_EXCLUSION = {
  type: 'object',
  required: ['dni'],
  additionalProperties: false,
  properties: { dni: DNI },
} as const;

/** Fichadas required for one sector. The sector name travels in the body for uniformity. */
export const ESQUEMA_CUERPO_SECTOR_REGLA = {
  type: 'object',
  required: ['sector', 'fichadasRequeridas'],
  additionalProperties: false,
  properties: {
    sector: { type: 'string', minLength: 1, maxLength: 200 },
    fichadasRequeridas: { type: 'integer', enum: [2, 4] },
  },
} as const;

/**
 * The two fields a multipart attachment upload carries besides the file itself.
 *
 * Not used as a Fastify body schema — multipart bodies do not go through AJV — but the
 * shape is checked by hand in `rutasAdjuntos.ts` against these same bounds.
 */
export const LIMITES_CAMPO_ADJUNTO = { maxDni: 32, maxNombre: 255 } as const;
