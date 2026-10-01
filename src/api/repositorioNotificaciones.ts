/**
 * Which faltas have already been notified: `[controlhorario].[faltas_notificadas]`.
 *
 * A falta is never stored — it is derived from the evidence on every read and has no id —
 * so what is stored here is its identity as the screen computes it, (dni, fecha, tipo), and
 * the fact that a Word covering it was generated. Generating the Word IS the notification;
 * there is no manual mark. See migration 005.
 *
 * INSERT ONLY. A key that is already there keeps its FIRST `notificado_at` and
 * `notificado_por`: the first time somebody was notified of a falta is the one that matters
 * if it is ever disputed. Every generation, first or not, is still one audit row per day.
 *
 * WHAT THE AUDIT ROWS LOOK LIKE. One row per (dni, fecha) day of the request, keyed
 * `DNI|YYYY-MM-DD` with `idDeDia`, exactly like the ausencias decisions — that is the unit an
 * auditor filters on, and a letter is about a person on a day. `datos` carries only falta
 * class codes: `tipos` (what the document covered that day) and `nuevas` (which of those were
 * recorded for the first time by this request). No name, no sector, no letter content.
 */

import type { TipoFalta } from '../domain/fichadas/tipos.js';
import { auditarVarios, idDeDia, type EntradaAuditoria } from './auditoria.js';
import { enTransaccion, type ConsultaSql, type Pool } from './db.js';
import { TIPOS_FALTA } from './esquemas.js';

/** One falta a generated document covered, as the route hands it over. */
export interface FaltaPedida {
  readonly dni: string;
  /** `YYYY-MM-DD`. */
  readonly fechaIso: string;
  readonly tipo: TipoFalta;
}

/** One recorded notification, as `GET /api/notificaciones` answers it. */
export interface FaltaNotificada {
  readonly dni: string;
  /** `YYYY-MM-DD`. */
  readonly fecha: string;
  readonly tipo: TipoFalta;
  /** ISO timestamp, UTC: the FIRST time a document covered this falta. */
  readonly notificadoAt: string;
}

interface FilaNotificada {
  dni: string;
  fecha: string;
  tipo: string;
  notificado_at: Date | string;
}

interface FilaInsertada {
  dni: string;
  fecha: string;
  tipo: string;
}

/**
 * Records the requested keys, inserting only the missing ones.
 *
 * Set-based like `sqlAsignarMotivos`: the keys travel as ONE JSON parameter (`$1`) expanded
 * with OPENJSON — `$n` becomes `@pn`, so a variable-length `IN` list is not an option — into
 * a table variable whose PRIMARY KEY refuses a duplicate rather than writing it twice; the
 * route deduplicates first. The MERGE has no WHEN MATCHED branch on purpose: an existing row
 * is left exactly as it is. HOLDLOCK keeps two concurrent generations of the same letter from
 * both seeing "missing" and colliding on the PK.
 *
 * The FK to `fichadas` is what refuses a day with no evidence; it fails the whole statement,
 * the transaction takes everything back, and the route answers the same 409 as ausencias.
 *
 * The answer is the keys this statement inserted, which is what the audit's `nuevas` and the
 * response's `registradas` count.
 */
export function sqlRegistrarNotificadas(
  faltas: readonly FaltaPedida[],
  actor: string,
): ConsultaSql {
  return {
    texto: `
    DECLARE @pedidas TABLE (
      [dni]   nvarchar(32) NOT NULL,
      [fecha] date NOT NULL,
      [tipo]  nvarchar(16) NOT NULL,
      PRIMARY KEY ([dni], [fecha], [tipo])
    );

    INSERT INTO @pedidas ([dni], [fecha], [tipo])
     SELECT [dni], [fecha], [tipo]
       FROM OPENJSON($1)
       WITH (
         [dni]   nvarchar(32) '$.dni',
         [fecha] date '$.fechaIso',
         [tipo]  nvarchar(16) '$.tipo'
       );

    DECLARE @insertadas TABLE (
      [dni]   nvarchar(32) NOT NULL,
      [fecha] date NOT NULL,
      [tipo]  nvarchar(16) NOT NULL
    );

    MERGE [controlhorario].[faltas_notificadas] WITH (HOLDLOCK) AS destino
    USING (SELECT p.[dni], p.[fecha], p.[tipo], CONVERT(nvarchar(320), $2) AS [actor]
             FROM @pedidas p) AS origen
       ON destino.[dni] = origen.[dni]
      AND destino.[fecha] = origen.[fecha]
      AND destino.[tipo] = origen.[tipo]
    WHEN NOT MATCHED THEN INSERT ([dni], [fecha], [tipo], [notificado_por])
      VALUES (origen.[dni], origen.[fecha], origen.[tipo], origen.[actor])
    OUTPUT inserted.[dni], inserted.[fecha], inserted.[tipo]
      INTO @insertadas ([dni], [fecha], [tipo]);

    SELECT i.[dni], CONVERT(char(10), i.[fecha], 23) AS [fecha], i.[tipo]
      FROM @insertadas i
     ORDER BY i.[dni], i.[fecha], i.[tipo];
  `,
    valores: [
      JSON.stringify(faltas.map((f) => ({ dni: f.dni, fechaIso: f.fechaIso, tipo: f.tipo }))),
      actor,
    ],
  };
}

/** The notifications inside a window of days, both ends included. */
export function sqlNotificadasEnVentana(desdeIso: string, hastaIso: string): ConsultaSql {
  return {
    texto: `
    SELECT n.[dni], CONVERT(char(10), n.[fecha], 23) AS [fecha], n.[tipo], n.[notificado_at]
      FROM [controlhorario].[faltas_notificadas] n
     WHERE n.[fecha] >= CONVERT(date, $1)
       AND n.[fecha] <= CONVERT(date, $2)
     ORDER BY n.[dni], n.[fecha], n.[tipo];
  `,
    valores: [desdeIso, hastaIso],
  };
}

/**
 * One audit row per day of the request, in first-seen order.
 *
 * Exported for its test: the shape of the trail is a decision, not a dialect.
 */
export function auditoriaDeNotificacion(
  faltas: readonly FaltaPedida[],
  insertadas: readonly { readonly dni: string; readonly fechaIso: string; readonly tipo: string }[],
  actor: string,
): readonly EntradaAuditoria[] {
  const nuevas = new Set(insertadas.map((f) => `${f.dni}|${f.fechaIso}|${f.tipo}`));
  const dias = new Map<string, { dni: string; fechaIso: string; tipos: Set<TipoFalta> }>();
  for (const f of faltas) {
    const clave = idDeDia(f.dni, f.fechaIso);
    let dia = dias.get(clave);
    if (!dia) {
      dia = { dni: f.dni, fechaIso: f.fechaIso, tipos: new Set() };
      dias.set(clave, dia);
    }
    dia.tipos.add(f.tipo);
  }
  return [...dias.values()].map((dia) => {
    // Engine order, so the same letter always audits the same `datos` text.
    const tipos = TIPOS_FALTA.filter((t) => dia.tipos.has(t));
    return {
      actor,
      accion: 'faltas_notificadas',
      entidad: 'faltas_notificadas',
      entidadId: idDeDia(dia.dni, dia.fechaIso),
      datos: {
        tipos,
        nuevas: tipos.filter((t) => nuevas.has(`${dia.dni}|${dia.fechaIso}|${t}`)),
      },
    };
  });
}

function aNotificada(f: FilaNotificada): FaltaNotificada {
  return {
    dni: f.dni,
    fecha: f.fecha,
    // The CHECK in migration 005 admits exactly these three values.
    tipo: f.tipo as TipoFalta,
    notificadoAt:
      f.notificado_at instanceof Date ? f.notificado_at.toISOString() : String(f.notificado_at),
  };
}

export interface RepositorioNotificacionesAzureSql {
  /** Recorded notifications whose day falls inside the window. */
  listar(desdeIso: string, hastaIso: string): Promise<readonly FaltaNotificada[]>;
  /**
   * Records that a document covering `faltas` was generated, in ONE transaction: the insert
   * of the missing keys and one audit row per day. `faltas` must be unique; the route
   * deduplicates. Returns how many keys were recorded for the first time.
   */
  registrar(faltas: readonly FaltaPedida[], actor: string): Promise<number>;
}

export function crearRepositorioNotificaciones(pool: Pool): RepositorioNotificacionesAzureSql {
  return {
    async listar(desdeIso, hastaIso) {
      const consulta = sqlNotificadasEnVentana(desdeIso, hastaIso);
      const { rows } = await pool.query<FilaNotificada>(consulta.texto, consulta.valores);
      return rows.map(aNotificada);
    },

    async registrar(faltas, actor) {
      if (faltas.length === 0) return 0;
      return enTransaccion(pool, async (cliente) => {
        const consulta = sqlRegistrarNotificadas(faltas, actor);
        const { rows } = await cliente.query<FilaInsertada>(consulta.texto, consulta.valores);
        await auditarVarios(
          cliente,
          auditoriaDeNotificacion(
            faltas,
            rows.map((r) => ({ dni: r.dni, fechaIso: r.fecha, tipo: r.tipo })),
            actor,
          ),
        );
        return rows.length;
      });
    },
  };
}
