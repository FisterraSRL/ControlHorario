/**
 * The absence registry: the Azure SQL side of `RepositorioAusencias`.
 *
 * WHY THIS FILE RUNS THE ENGINE.
 *
 * `ausencias_pendientes` in migration 001 is only correct if something upserts a row for
 * every day that IS an absence. SQL cannot decide that: "is this day an absence?" is a
 * rule, the rules live in `src/domain/fichadas`, and re-implementing them in a view would
 * be exactly the two-sources-of-truth mistake the schema's own comments spend three
 * paragraphs refusing. So the engine decides and the database records — which is the port
 * of `syncAusenciasHistorial()` from the legacy file, moved from the browser to the server
 * because the registry is now shared by everyone instead of living in one artifact.
 *
 * It runs at import time, over the WHOLE accumulated historial and not only over the rows
 * that were just uploaded. That is what the legacy `recompute()` did, and it is what makes
 * a rule fix retroactive: deploy a corrected engine, upload anything, and every day in the
 * history is re-evaluated in the same pass.
 *
 * TWO RULES THE SYNC MUST NOT BREAK, both ported verbatim from the legacy comments:
 *
 *   1. A motivo a human chose is never overwritten by a re-upload. The legacy file said
 *      `manual`; this one also protects `encargado`, because by the time slice 3 exists a
 *      manager's answer is a human decision too and the schema is explicit that those are
 *      preserved rather than discarded (001, `discrepancias`).
 *
 *   2. Pruning is conservative. A registry entry is only removed when it is no longer an
 *      absence AND nobody classified it AND nothing is attached to it. Anything a person
 *      touched is left alone, forever, even if the evidence under it changed.
 */

import { construirRegistroDia } from '../domain/fichadas/dia.js';
import { parsearFechaDMY } from '../domain/fichadas/parseo.js';
import type { ConfiguracionFichadas, FilaQuickpass } from '../domain/fichadas/tipos.js';
import { auditar, idDeDia } from './auditoria.js';
import { enTransaccion, type Pool, type PoolClient } from './db.js';

/** One row of the registry, as the API hands it to the screen. */
export interface AusenciaRegistrada {
  readonly dni: string;
  /** `YYYY-MM-DD`. The screen joins on this; the raw `DD/MM/YYYY` cell stays in `fichadas`. */
  readonly fecha: string;
  readonly motivoId: number | null;
  readonly motivoSource: 'partes' | 'manual' | 'encargado' | null;
  readonly resueltoPor: string | null;
  readonly resueltoAt: string | null;
  /** How many files are filed against this day. The metadata itself is a separate call. */
  readonly adjuntos: number;
}

export interface ResultadoSincronizacion {
  /** Days the engine currently reads as an absence. */
  readonly vigentes: number;
  /** Registry rows created by this pass. */
  readonly creadas: number;
  /** Rows whose motivo derived from the QUICKPASS note changed. */
  readonly refrescadas: number;
  /** Orphaned rows removed. See `pruneStaleAusencias` in the legacy file. */
  readonly podadas: number;
}

const SQL_REGISTRO = `
  SELECT a.[dni],
         CONVERT(char(10), a.[fecha], 23) AS [fecha],
         a.[motivo_id],
         a.[motivo_source],
         a.[resuelto_por],
         a.[resuelto_at],
         (SELECT CAST(COUNT_BIG(*) AS int)
            FROM [controlhorario].[adjuntos] ad
           WHERE ad.[dni] = a.[dni] AND ad.[fecha] = a.[fecha]) AS [adjuntos]
    FROM [controlhorario].[ausencias] a
   ORDER BY a.[dni], a.[fecha]
`;

interface FilaRegistro {
  dni: string;
  fecha: string;
  motivo_id: number | null;
  motivo_source: string | null;
  resuelto_por: string | null;
  resuelto_at: Date | string | null;
  adjuntos: number;
}

function aRegistro(f: FilaRegistro): AusenciaRegistrada {
  return {
    dni: f.dni,
    fecha: f.fecha,
    motivoId: f.motivo_id,
    motivoSource: (f.motivo_source ?? null) as AusenciaRegistrada['motivoSource'],
    resueltoPor: f.resuelto_por,
    resueltoAt:
      f.resuelto_at === null
        ? null
        : f.resuelto_at instanceof Date
          ? f.resuelto_at.toISOString()
          : String(f.resuelto_at),
    adjuntos: Number(f.adjuntos),
  };
}

/**
 * The days the engine currently calls absences, with the motivo the QUICKPASS note implies.
 *
 * `cfg.ausencias` is deliberately NOT passed in. With it, `construirRegistroDia` would hand
 * back the motivo already on record — which is the right answer for a screen and the wrong
 * one here, because this function's whole job is to produce what the EVIDENCE says so that
 * the SQL below can decide whether the evidence may overwrite the record.
 */
interface DiaVigente {
  readonly dni: string;
  readonly fechaIso: string;
  readonly motivoId: number | null;
  readonly motivoSource: string | null;
}

export function diasDeAusencia(
  filas: readonly FilaQuickpass[],
  cfg: ConfiguracionFichadas,
): readonly DiaVigente[] {
  const sinDecisiones: ConfiguracionFichadas = { ...cfg, ausencias: {} };
  const vigentes: DiaVigente[] = [];
  for (const fila of filas) {
    const registro = construirRegistroDia(fila, sinDecisiones);
    if (registro.tipoDia !== 'ausencia') continue;
    if (!registro.dni) continue;
    const fecha = parsearFechaDMY(registro.fechaStr);
    // A day Azure SQL cannot date is a day that is not in `fichadas` either (the primary key
    // is (dni, fecha) and fecha is a DATE), so there is nothing for a registry row to point
    // at. `repositorioAzureSql.prepararFilas` counts the same rows as `descartadas`.
    if (!fecha) continue;
    vigentes.push({
      dni: registro.dni,
      fechaIso: fecha.toISOString().slice(0, 10),
      motivoId: registro.motivoId,
      motivoSource: registro.motivoSource,
    });
  }
  return vigentes;
}

/** Materialises and synchronises the evidence in one SQL batch. */
async function sincronizarVigentes(
  cliente: PoolClient,
  vigentes: readonly DiaVigente[],
): Promise<{ creadas: number; refrescadas: number; podadas: number }> {
  const { rows } = await cliente.query<{
    creadas: number;
    refrescadas: number;
    podadas: number;
  }>(`
    DECLARE @ausencias_vigentes TABLE (
      [dni]           nvarchar(32) NOT NULL,
      [fecha]         date NOT NULL,
      [motivo_id]     int NULL,
      [motivo_source] nvarchar(16) NULL,
      PRIMARY KEY ([dni], [fecha])
    );

    INSERT INTO @ausencias_vigentes ([dni], [fecha], [motivo_id], [motivo_source])
     SELECT [dni], [fecha], [motivo_id], [motivo_source]
       FROM OPENJSON($1)
       WITH (
         [dni] nvarchar(32) '$.dni',
         [fecha] date '$.fechaIso',
         [motivo_id] int '$.motivoId',
         [motivo_source] nvarchar(16) '$.motivoSource'
       );

    DECLARE @acciones TABLE ([accion] nvarchar(10) NOT NULL);

    MERGE [controlhorario].[ausencias] WITH (HOLDLOCK) AS destino
    USING @ausencias_vigentes AS origen
       ON destino.[dni] = origen.[dni] AND destino.[fecha] = origen.[fecha]
    WHEN MATCHED
         AND ISNULL(destino.[motivo_source], N'') NOT IN (N'manual', N'encargado')
         AND (ISNULL(destino.[motivo_id], -1) <> ISNULL(origen.[motivo_id], -1)
           OR ISNULL(destino.[motivo_source], N'') <> ISNULL(origen.[motivo_source], N''))
      THEN UPDATE SET
        [motivo_id] = origen.[motivo_id],
        [motivo_source] = origen.[motivo_source]
    WHEN NOT MATCHED THEN
      INSERT ([dni], [fecha], [motivo_id], [motivo_source])
      VALUES (origen.[dni], origen.[fecha], origen.[motivo_id], origen.[motivo_source])
    OUTPUT $action INTO @acciones;

    DELETE a
      FROM [controlhorario].[ausencias] a
     WHERE a.[motivo_id] IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM [controlhorario].[adjuntos] ad
          WHERE ad.[dni] = a.[dni] AND ad.[fecha] = a.[fecha]
       )
       AND NOT EXISTS (
         SELECT 1 FROM @ausencias_vigentes v
          WHERE v.[dni] = a.[dni] AND v.[fecha] = a.[fecha]
       );
    DECLARE @podadas int = @@ROWCOUNT;

    SELECT
      CONVERT(int, COALESCE(SUM(CASE WHEN [accion] = N'INSERT' THEN 1 ELSE 0 END), 0)) AS [creadas],
      CONVERT(int, COALESCE(SUM(CASE WHEN [accion] = N'UPDATE' THEN 1 ELSE 0 END), 0)) AS [refrescadas],
      @podadas AS [podadas]
    FROM @acciones;
  `, [JSON.stringify(vigentes)]);
  return rows[0] ?? { creadas: 0, refrescadas: 0, podadas: 0 };
}

export interface RepositorioAusenciasAzureSql {
  listar(): Promise<readonly AusenciaRegistrada[]>;
  /**
   * Sets or clears the motivo of one day, always as `manual`.
   *
   * Always `manual`, exactly like the legacy `setMotivo`: an operator who picks a motivo on
   * this screen is RRHH deciding, and a later re-upload must not silently override it. That
   * is the same fact rule 1 above enforces, written from the other side.
   */
  asignarMotivo(
    dni: string,
    fechaIso: string,
    motivoId: number | null,
    actor: string,
  ): Promise<AusenciaRegistrada | null>;
  /** Re-derives the registry from the evidence. Called after every upload. */
  sincronizar(
    filas: readonly FilaQuickpass[],
    cfg: ConfiguracionFichadas,
    actor: string,
  ): Promise<ResultadoSincronizacion>;
}

export function crearRepositorioAusencias(pool: Pool): RepositorioAusenciasAzureSql {
  return {
    async listar() {
      const { rows } = await pool.query<FilaRegistro>(SQL_REGISTRO);
      return rows.map(aRegistro);
    },

    async asignarMotivo(dni, fechaIso, motivoId, actor) {
      return enTransaccion(pool, async (cliente) => {
        const { rows: previas } = await cliente.query<{ motivo_id: number | null }>(
          `SELECT [motivo_id] FROM [controlhorario].[ausencias]
            WHERE [dni] = $1 AND [fecha] = $2`,
          [dni, fechaIso],
        );
        const anterior = previas[0]?.motivo_id ?? null;

        const { rows } = await cliente.query<FilaRegistro>(
          `MERGE [controlhorario].[ausencias] WITH (HOLDLOCK) AS destino
           USING (SELECT $1 AS [dni], CONVERT(date, $2) AS [fecha], $3 AS [motivo_id],
                         $4 AS [actor]) AS origen
              ON destino.[dni] = origen.[dni] AND destino.[fecha] = origen.[fecha]
           WHEN MATCHED THEN UPDATE SET
             [motivo_id] = origen.[motivo_id],
             [motivo_source] = CASE WHEN origen.[motivo_id] IS NULL THEN NULL ELSE N'manual' END,
             [resuelto_por] = origen.[actor],
             [resuelto_at] = SYSUTCDATETIME()
           WHEN NOT MATCHED THEN INSERT
             ([dni], [fecha], [motivo_id], [motivo_source], [resuelto_por], [resuelto_at])
             VALUES (
               origen.[dni], origen.[fecha], origen.[motivo_id],
               CASE WHEN origen.[motivo_id] IS NULL THEN NULL ELSE N'manual' END,
               origen.[actor], SYSUTCDATETIME()
             )
           OUTPUT inserted.[dni], CONVERT(char(10), inserted.[fecha], 23) AS [fecha],
                  inserted.[motivo_id], inserted.[motivo_source], inserted.[resuelto_por],
                  inserted.[resuelto_at], CONVERT(int, 0) AS [adjuntos];`,
          [dni, fechaIso, motivoId, actor],
        );
        const fila = rows[0];
        if (!fila) return null;

        await auditar(cliente, {
          actor,
          accion: motivoId === null ? 'motivo_quitado' : 'motivo_asignado',
          entidad: 'ausencias',
          entidadId: idDeDia(dni, fechaIso),
          // Ids only. Never the label, never the person's name: a motivo label is
          // "Enfermedad", and `auditoria` is read by more people than `ausencias` is.
          datos: { motivoId, motivoAnterior: anterior },
        });

        const { rows: conteo } = await cliente.query<{ n: number }>(
          `SELECT CAST(COUNT_BIG(*) AS int) AS [n]
             FROM [controlhorario].[adjuntos] WHERE [dni] = $1 AND [fecha] = $2`,
          [dni, fechaIso],
        );
        return aRegistro({ ...fila, adjuntos: Number(conteo[0]?.n ?? 0) });
      });
    },

    async sincronizar(filas, cfg, actor) {
      const vigentes = diasDeAusencia(filas, cfg);

      return enTransaccion(pool, async (cliente) => {
        const { creadas, refrescadas, podadas } = await sincronizarVigentes(cliente, vigentes);

        const resultado: ResultadoSincronizacion = {
          vigentes: vigentes.length,
          creadas,
          refrescadas,
          podadas,
        };

        // Counts only: this row says the registry was re-derived and by how much, which is
        // what somebody auditing a rule change needs. Who it was about is in `ausencias`.
        if (creadas > 0 || refrescadas > 0 || podadas > 0) {
          await auditar(cliente, {
            actor,
            accion: 'ausencias_sincronizadas',
            entidad: 'ausencias',
            entidadId: null,
            datos: { ...resultado },
          });
        }

        return resultado;
      });
    },
  };
}
