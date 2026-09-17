/**
 * The Azure SQL side of `RepositorioConfiguracion`: everything the Configuración screen edits.
 *
 * Four different things share this file because they are one screen and one atomic read:
 * the three global parameters (`configuracion`), the per-sector fichada rule
 * (`sector_reglas`), the closed list of motivos (`motivos`, from 001) and the exclusion list
 * (`exclusiones`, also from 001).
 *
 * TWO THINGS THAT LOOK LIKE OVERSIGHTS AND ARE NOT:
 *
 *   * A motivo is retired, never deleted. `motivos.id` is referenced by `ausencias` and
 *     `respuestas` with `ON DELETE RESTRICT`, so deleting one would either fail or, if it
 *     succeeded, erase the meaning of every decision that used it. The legacy screen removed
 *     it from an array in a JSON blob and the history it left behind pointed at nothing.
 *     Here `activo = false` takes it out of the dropdown and leaves the record readable.
 *
 *   * The exclusion seed is applied ONCE PER DNI, ever. That is the useful half of the
 *     legacy `ensureDefaultExclusions()`: `cfg.autoExcludedApplied` existed so that an
 *     operator who removed somebody from the list by hand did not find them back on it
 *     after the next recompute. `exclusiones_semilla` is that array, in a table.
 */

import {
  MOTIVOS_POR_DEFECTO,
  type ConfiguracionFichadas,
  type Motivo,
} from '../domain/fichadas/index.js';
import { auditar } from './auditoria.js';
import { enTransaccion, type Pool, type PoolClient } from './db.js';

export interface ParametrosConfiguracion {
  readonly descansoMaxMin: number;
  readonly toleranciaMin: number;
  readonly horasTurnoSemanales: number;
}

export interface Exclusion {
  readonly dni: string;
  readonly motivoTexto: string | null;
  readonly creadoPor: string | null;
  readonly creadoAt: string;
}

export interface ConfiguracionCompleta {
  readonly parametros: ParametrosConfiguracion;
  /** Sector -> fichadas required. A sector absent from here requires four. */
  readonly reglasSector: Readonly<Record<string, number>>;
  /** Active motivos only, in id order. Retired ones stay readable through `ausencias`. */
  readonly motivos: readonly Motivo[];
  readonly exclusiones: readonly Exclusion[];
}

/**
 * The defaults, used when a key is missing from `configuracion`.
 *
 * They duplicate the values migration 002 seeds, on purpose: a rollback to an older
 * database, or a key somebody deleted with psql, must not make the engine read `undefined`
 * minutes of tolerance. They are the same numbers the domain layer already falls back to.
 */
const PARAMETROS_POR_DEFECTO: ParametrosConfiguracion = {
  descansoMaxMin: 30,
  toleranciaMin: 0,
  horasTurnoSemanales: 51,
};

/** The keys of `configuracion`, paired with the field of `ParametrosConfiguracion` they fill. */
const CLAVES: readonly (readonly [string, keyof ParametrosConfiguracion])[] = [
  ['descanso_max_min', 'descansoMaxMin'],
  ['tolerancia_min', 'toleranciaMin'],
  ['horas_turno_semanales', 'horasTurnoSemanales'],
];

function numeroDeJson(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  // The adapter parses valid JSON, but a value written by hand may still arrive as text.
  if (typeof valor === 'string') {
    const n = Number(valor);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function leerParametros(cliente: Pool | PoolClient): Promise<ParametrosConfiguracion> {
  const { rows } = await cliente.query<{ clave: string; valor: unknown }>(
    'SELECT [clave], [valor] FROM [controlhorario].[configuracion]',
  );
  const porClave = new Map(rows.map((r) => [r.clave, r.valor]));
  const salida: Record<string, number> = { ...PARAMETROS_POR_DEFECTO };
  for (const [clave, campo] of CLAVES) {
    const n = numeroDeJson(porClave.get(clave));
    // An unreadable value falls back rather than throwing. A configuración row somebody
    // broke must not stop the whole app from booting.
    if (n !== null) salida[campo] = n;
  }
  return salida as unknown as ParametrosConfiguracion;
}

async function leerReglasSector(
  cliente: Pool | PoolClient,
): Promise<Record<string, number>> {
  const { rows } = await cliente.query<{ sector: string; fichadas_requeridas: number }>(
    'SELECT [sector], [fichadas_requeridas] FROM [controlhorario].[sector_reglas]',
  );
  const reglas: Record<string, number> = {};
  for (const r of rows) reglas[r.sector] = r.fichadas_requeridas;
  return reglas;
}

async function leerMotivos(cliente: Pool | PoolClient): Promise<readonly Motivo[]> {
  const { rows } = await cliente.query<{ id: number; label: string; worked: boolean }>(
    `SELECT [id], [label], [worked] FROM [controlhorario].[motivos]
      WHERE [activo] = 1 ORDER BY [id]`,
  );
  // An empty table would silently mean "no motivo can be chosen", which looks like a broken
  // screen rather than a broken database. The engine's own list is the floor.
  if (rows.length === 0) return MOTIVOS_POR_DEFECTO;
  return rows.map((r) => ({ id: r.id, label: r.label, worked: r.worked }));
}

async function leerExclusiones(cliente: Pool | PoolClient): Promise<readonly Exclusion[]> {
  const { rows } = await cliente.query<{
    dni: string;
    motivo_texto: string | null;
    creado_por: string | null;
    creado_at: Date | string;
  }>(
    `SELECT [dni], [motivo_texto], [creado_por], [creado_at]
       FROM [controlhorario].[exclusiones] ORDER BY [dni]`,
  );
  return rows.map((r) => ({
    dni: r.dni,
    motivoTexto: r.motivo_texto,
    creadoPor: r.creado_por,
    creadoAt: r.creado_at instanceof Date ? r.creado_at.toISOString() : String(r.creado_at),
  }));
}

export interface RepositorioConfiguracionAzureSql {
  leer(): Promise<ConfiguracionCompleta>;
  /** The same values, shaped as the engine's own config. Used by the absence sync. */
  paraElMotor(): Promise<ConfiguracionFichadas>;
  guardarParametros(
    cambios: Partial<ParametrosConfiguracion>,
    actor: string,
  ): Promise<ParametrosConfiguracion>;
  guardarReglaSector(
    sector: string,
    fichadasRequeridas: number,
    actor: string,
  ): Promise<Readonly<Record<string, number>>>;
  crearMotivo(label: string, worked: boolean, actor: string): Promise<Motivo>;
  editarMotivo(id: number, worked: boolean, actor: string): Promise<Motivo | null>;
  /** Retires a motivo: `activo = false`. Never a DELETE — see the header. */
  retirarMotivo(id: number, actor: string): Promise<boolean>;
  agregarExclusion(dni: string, motivoTexto: string | null, actor: string): Promise<Exclusion>;
  quitarExclusion(dni: string, actor: string): Promise<boolean>;
  /**
   * Applies the runtime exclusion seed, once per DNI, ever.
   *
   * Called at boot with whatever `EXCLUSIONES_INICIALES` holds. A DNI already in
   * `exclusiones_semilla` is skipped even if it is no longer in `exclusiones`, which is
   * exactly the property `cfg.autoExcludedApplied` had: an operator's removal is final.
   */
  sembrarExclusiones(dnis: readonly string[], actor: string): Promise<number>;
}

export function crearRepositorioConfiguracion(pool: Pool): RepositorioConfiguracionAzureSql {
  return {
    async leer() {
      const [parametros, reglasSector, motivos, exclusiones] = await Promise.all([
        leerParametros(pool),
        leerReglasSector(pool),
        leerMotivos(pool),
        leerExclusiones(pool),
      ]);
      return { parametros, reglasSector, motivos, exclusiones };
    },

    async paraElMotor() {
      const completa = await this.leer();
      return {
        reglasSector: completa.reglasSector,
        dniExcluidos: completa.exclusiones.map((e) => e.dni),
        motivos: completa.motivos,
        descansoMaxMin: completa.parametros.descansoMaxMin,
        toleranciaMin: completa.parametros.toleranciaMin,
        horasTurnoSemanales: completa.parametros.horasTurnoSemanales,
      };
    },

    async guardarParametros(cambios, actor) {
      return enTransaccion(pool, async (cliente) => {
        for (const [clave, campo] of CLAVES) {
          const valor = cambios[campo];
          if (valor === undefined) continue;
          await cliente.query(
            `MERGE [controlhorario].[configuracion] WITH (HOLDLOCK) AS destino
             USING (SELECT $1 AS [clave], $2 AS [valor], $3 AS [actor]) AS origen
                ON destino.[clave] = origen.[clave]
             WHEN MATCHED THEN UPDATE SET
               [valor] = origen.[valor],
               [actualizado_por] = origen.[actor],
               [actualizado_at] = SYSUTCDATETIME()
             WHEN NOT MATCHED THEN INSERT ([clave], [valor], [actualizado_por], [actualizado_at])
               VALUES (origen.[clave], origen.[valor], origen.[actor], SYSUTCDATETIME());`,
            [clave, JSON.stringify(valor), actor],
          );
          await auditar(cliente, {
            actor,
            accion: 'config_actualizada',
            entidad: 'configuracion',
            entidadId: clave,
            datos: { valor },
          });
        }
        return leerParametros(cliente);
      });
    },

    async guardarReglaSector(sector, fichadasRequeridas, actor) {
      return enTransaccion(pool, async (cliente) => {
        await cliente.query(
          `MERGE [controlhorario].[sector_reglas] WITH (HOLDLOCK) AS destino
           USING (SELECT $1 AS [sector], $2 AS [fichadas], $3 AS [actor]) AS origen
              ON destino.[sector] = origen.[sector]
           WHEN MATCHED THEN UPDATE SET
             [fichadas_requeridas] = origen.[fichadas],
             [actualizado_por] = origen.[actor],
             [actualizado_at] = SYSUTCDATETIME()
           WHEN NOT MATCHED THEN INSERT
             ([sector], [fichadas_requeridas], [actualizado_por], [actualizado_at])
             VALUES (origen.[sector], origen.[fichadas], origen.[actor], SYSUTCDATETIME());`,
          [sector, fichadasRequeridas, actor],
        );
        await auditar(cliente, {
          actor,
          accion: 'sector_regla_actualizada',
          entidad: 'sector_reglas',
          entidadId: sector,
          datos: { fichadasRequeridas },
        });
        return leerReglasSector(cliente);
      });
    },

    async crearMotivo(label, worked, actor) {
      return enTransaccion(pool, async (cliente) => {
        /**
         * `motivos.id` is a plain INTEGER PRIMARY KEY with no identity: 001 seeds ids 1-9
         * by hand because those numbers are printed into notifications and referenced by
         * the engine (`ID_OLVIDO_FICHAR = 8`). So the next id is computed, exactly as the
         * legacy screen did. The row lock below is what stops two operators adding a motivo
         * at the same moment and colliding on it.
         */
        const { rows: maximos } = await cliente.query<{ siguiente: number }>(
          `SELECT ISNULL(MAX([id]), 0) + 1 AS [siguiente]
             FROM [controlhorario].[motivos] WITH (UPDLOCK, HOLDLOCK)`,
        );
        const id = maximos[0]?.siguiente ?? 1;
        const { rows } = await cliente.query<{ id: number; label: string; worked: boolean }>(
          `INSERT INTO [controlhorario].[motivos] ([id], [label], [worked], [activo])
           OUTPUT inserted.[id], inserted.[label], inserted.[worked]
           VALUES ($1, $2, $3, 1)`,
          [id, label.trim(), worked],
        );
        const motivo = rows[0];
        if (!motivo) throw new Error('El INSERT en motivos no devolvió la fila.');
        await auditar(cliente, {
          actor,
          accion: 'motivo_creado',
          entidad: 'motivos',
          entidadId: String(id),
          datos: { worked },
        });
        return { id: motivo.id, label: motivo.label, worked: motivo.worked };
      });
    },

    async editarMotivo(id, worked, actor) {
      return enTransaccion(pool, async (cliente) => {
        const { rows } = await cliente.query<{ id: number; label: string; worked: boolean }>(
          `UPDATE [controlhorario].[motivos]
              SET [worked] = $2
           OUTPUT inserted.[id], inserted.[label], inserted.[worked]
            WHERE [id] = $1 AND [activo] = 1`,
          [id, worked],
        );
        const motivo = rows[0];
        if (!motivo) return null;
        await auditar(cliente, {
          actor,
          accion: 'motivo_editado',
          entidad: 'motivos',
          entidadId: String(id),
          datos: { worked },
        });
        return { id: motivo.id, label: motivo.label, worked: motivo.worked };
      });
    },

    async retirarMotivo(id, actor) {
      return enTransaccion(pool, async (cliente) => {
        const { rowCount } = await cliente.query(
          'UPDATE [controlhorario].[motivos] SET [activo] = 0 WHERE [id] = $1 AND [activo] = 1',
          [id],
        );
        if ((rowCount ?? 0) === 0) return false;
        await auditar(cliente, {
          actor,
          accion: 'motivo_retirado',
          entidad: 'motivos',
          entidadId: String(id),
          datos: null,
        });
        return true;
      });
    },

    async agregarExclusion(dni, motivoTexto, actor) {
      return enTransaccion(pool, async (cliente) => {
        const { rows } = await cliente.query<{
          dni: string;
          motivo_texto: string | null;
          creado_por: string | null;
          creado_at: Date | string;
        }>(
          `MERGE [controlhorario].[exclusiones] WITH (HOLDLOCK) AS destino
           USING (SELECT $1 AS [dni], $2 AS [motivo_texto], $3 AS [creado_por]) AS origen
              ON destino.[dni] = origen.[dni]
           WHEN MATCHED THEN UPDATE SET [motivo_texto] = origen.[motivo_texto]
           WHEN NOT MATCHED THEN INSERT ([dni], [motivo_texto], [creado_por])
             VALUES (origen.[dni], origen.[motivo_texto], origen.[creado_por])
           OUTPUT inserted.[dni], inserted.[motivo_texto], inserted.[creado_por], inserted.[creado_at];`,
          [dni, motivoTexto, actor],
        );
        const fila = rows[0];
        if (!fila) throw new Error('El INSERT en exclusiones no devolvió la fila.');
        await auditar(cliente, {
          actor,
          accion: 'exclusion_agregada',
          entidad: 'exclusiones',
          entidadId: dni,
          datos: null,
        });
        return {
          dni: fila.dni,
          motivoTexto: fila.motivo_texto,
          creadoPor: fila.creado_por,
          creadoAt:
            fila.creado_at instanceof Date ? fila.creado_at.toISOString() : String(fila.creado_at),
        };
      });
    },

    async quitarExclusion(dni, actor) {
      return enTransaccion(pool, async (cliente) => {
        const { rowCount } = await cliente.query(
          'DELETE FROM [controlhorario].[exclusiones] WHERE [dni] = $1',
          [dni],
        );
        if ((rowCount ?? 0) === 0) return false;
        /**
         * The seed ledger is NOT touched here. That is the entire point: removing somebody
         * by hand has to be permanent, and it is permanent precisely because
         * `exclusiones_semilla` still remembers that the seed already ran for this DNI.
         */
        await auditar(cliente, {
          actor,
          accion: 'exclusion_quitada',
          entidad: 'exclusiones',
          entidadId: dni,
          datos: null,
        });
        return true;
      });
    },

    async sembrarExclusiones(dnis, actor) {
      const limpios = [...new Set(dnis.map((d) => d.trim()).filter((d) => d !== ''))];
      if (limpios.length === 0) return 0;

      return enTransaccion(pool, async (cliente) => {
        // The ledger is written first: only DNIs claimed by this MERGE get an exclusion.
        // Existing ledger rows are skipped even if the current exclusion was removed.
        const { rows: nuevos } = await cliente.query<{ dni: string }>(
          `MERGE [controlhorario].[exclusiones_semilla] WITH (HOLDLOCK) AS destino
           USING (SELECT CONVERT(nvarchar(32), [value]) AS [dni] FROM OPENJSON($1)) AS origen
              ON destino.[dni] = origen.[dni]
           WHEN NOT MATCHED THEN INSERT ([dni]) VALUES (origen.[dni])
           OUTPUT inserted.[dni];`,
          [JSON.stringify(limpios)],
        );
        if (nuevos.length === 0) return 0;

        await cliente.query(
          `MERGE [controlhorario].[exclusiones] WITH (HOLDLOCK) AS destino
           USING (SELECT CONVERT(nvarchar(32), [value]) AS [dni] FROM OPENJSON($1)) AS origen
              ON destino.[dni] = origen.[dni]
           WHEN NOT MATCHED THEN INSERT ([dni], [motivo_texto], [creado_por])
             VALUES (origen.[dni], $2, $3);`,
          [JSON.stringify(nuevos.map((n) => n.dni)), 'Semilla inicial del servidor', actor],
        );

        // Counts only: the DNIs are the personal data this whole mechanism exists to keep
        // out of files that get copied around, and an audit row is such a file.
        await auditar(cliente, {
          actor,
          accion: 'exclusiones_sembradas',
          entidad: 'exclusiones',
          entidadId: null,
          datos: { agregadas: nuevos.length },
        });
        return nuevos.length;
      });
    },
  };
}
