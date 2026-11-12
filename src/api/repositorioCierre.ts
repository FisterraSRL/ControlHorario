import {
  DIA_CORTE_PREDETERMINADO, esDiaCorte, type ClaveIrregularidad,
  type DecisionIrregularidad, type RevisionIrregularidad,
} from '../domain/cierre.js';
import { auditar, idDeDia } from './auditoria.js';
import { enTransaccion, type Pool } from './db.js';
import { guardarParametro } from './repositorioConfiguracion.js';
import { filtroDeSector, valorDeAlcance, type AlcanceSectores } from './sectores.js';

const CLAVE_CORTE = 'dia_corte_novedades';
const SECTOR = "JSON_VALUE(f.[payload], '$.Sector')";

export interface RepositorioCierreAzureSql {
  leerCorte(): Promise<number>;
  guardarCorte(dia: number, actor: string): Promise<void>;
  listar(desde: string, hasta: string, alcance: AlcanceSectores): Promise<readonly RevisionIrregularidad[]>;
  decidir(clave: ClaveIrregularidad, decision: DecisionIrregularidad | null, actor: string, alcance: AlcanceSectores): Promise<boolean>;
}

export function crearRepositorioCierre(pool: Pool): RepositorioCierreAzureSql {
  return {
    async leerCorte() {
      const { rows } = await pool.query<{ valor: unknown }>(
        'SELECT [valor] FROM [controlhorario].[configuracion] WHERE [clave] = $1',
        [CLAVE_CORTE],
      );
      if (!rows[0]) return DIA_CORTE_PREDETERMINADO;
      const dia = rows[0].valor;
      if (!esDiaCorte(dia)) throw new Error('Invalid closing day in configuration.');
      return dia;
    },
    async guardarCorte(dia, actor) {
      await enTransaccion(pool, (cliente) => guardarParametro(cliente, CLAVE_CORTE, dia, actor));
    },
    async listar(desde, hasta, alcance) {
      const { rows } = await pool.query<RevisionIrregularidad>(
        `SELECT r.[dni], CONVERT(char(10), r.[fecha], 23) AS [fecha], r.[tipo], r.[estado], r.[nota]
           FROM [controlhorario].[irregularidades_revisadas] r
           JOIN [controlhorario].[fichadas] f ON f.[dni] = r.[dni] AND f.[fecha] = r.[fecha]
          WHERE r.[fecha] BETWEEN CONVERT(date, $1) AND CONVERT(date, $2)
          ${alcance === null ? '' : `AND ${filtroDeSector(SECTOR, 3)}`}`,
        alcance === null ? [desde, hasta] : [desde, hasta, valorDeAlcance(alcance)],
      );
      return rows;
    },
    async decidir({ dni, fecha, tipo }, decision, actor, alcance) {
      return enTransaccion(pool, async (cliente) => {
        // Hold the evidence row so an import cannot move the day to another sector
        // between checking its current scope and recording the decision.
        const { rows } = await cliente.query<{ presente: number }>(
          `SELECT 1 AS [presente]
             FROM [controlhorario].[fichadas] f WITH (UPDLOCK, HOLDLOCK)
            WHERE f.[dni] = $1 AND f.[fecha] = CONVERT(date, $2)
            ${alcance === null ? '' : `AND ${filtroDeSector(SECTOR, 3)}`}`,
          alcance === null ? [dni, fecha] : [dni, fecha, valorDeAlcance(alcance)],
        );
        if (rows.length === 0) return false;

        if (decision === null) {
          const { rowCount } = await cliente.query(
            `DELETE FROM [controlhorario].[irregularidades_revisadas]
              WHERE [dni] = $1 AND [fecha] = CONVERT(date, $2) AND [tipo] = $3`,
            [dni, fecha, tipo],
          );
          if (rowCount === 0) return true;
        } else {
          await cliente.query(
            `MERGE [controlhorario].[irregularidades_revisadas] WITH (HOLDLOCK) AS destino
             USING (SELECT $1 AS [dni], CONVERT(date, $2) AS [fecha], $3 AS [tipo]) AS origen
                ON destino.[dni] = origen.[dni] AND destino.[fecha] = origen.[fecha] AND destino.[tipo] = origen.[tipo]
             WHEN MATCHED THEN UPDATE SET [estado] = $4, [nota] = $5
             WHEN NOT MATCHED THEN INSERT ([dni], [fecha], [tipo], [estado], [nota])
               VALUES (origen.[dni], origen.[fecha], origen.[tipo], $4, $5);`,
            [dni, fecha, tipo, decision.estado, decision.nota],
          );
        }
        await auditar(cliente, {
          actor,
          accion: 'irregularidad_revisada',
          entidad: 'irregularidades_revisadas',
          entidadId: idDeDia(dni, fecha),
          datos: { tipo, estado: decision?.estado ?? null },
        });
        return true;
      });
    },
  };
}
