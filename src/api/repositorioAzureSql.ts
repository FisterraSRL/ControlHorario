/** Azure SQL implementation of the attendance-history repository. */

import { parsearFechaDMY } from '../domain/fichadas/parseo.js';
import type { FilaQuickpass } from '../domain/fichadas/tipos.js';
import { claveDeFila } from '../ui/historial/RepositorioFichadas.js';
import type { ClaveFichada, ResultadoGuardado } from '../ui/historial/RepositorioFichadas.js';
import { enTransaccion, type ConsultaSql, type Pool, type PoolClient } from './db.js';
import { filtroDeSector, valorDeAlcance, type AlcanceSectores } from './sectores.js';

const TAMANO_LOTE = 1_000;

export interface DatosCarga {
  readonly archivo: string;
  readonly subidoPor: string;
}

interface FilaPreparada {
  readonly dni: string;
  readonly fecha: string;
  readonly payload: string;
}

interface Preparacion {
  readonly filas: readonly FilaPreparada[];
  readonly descartadas: number;
  readonly duplicadasIguales: number;
  readonly duplicadasDistintas: number;
}

function prepararFilas(filas: readonly FilaQuickpass[]): Preparacion {
  const porClave = new Map<ClaveFichada, FilaPreparada>();
  let descartadas = 0;
  let duplicadasIguales = 0;
  let duplicadasDistintas = 0;

  for (const fila of filas) {
    const clave = claveDeFila(fila);
    const fecha = parsearFechaDMY(fila['Fecha']);
    if (!clave || !fecha) {
      descartadas++;
      continue;
    }
    const payload = JSON.stringify(fila);
    const preparada: FilaPreparada = {
      dni: String(fila['DNI']),
      fecha: fecha.toISOString().slice(0, 10),
      payload,
    };
    const previa = porClave.get(clave);
    if (previa) {
      if (previa.payload === payload) duplicadasIguales++;
      else duplicadasDistintas++;
    }
    porClave.set(clave, preparada);
  }

  return {
    filas: [...porClave.values()],
    descartadas,
    duplicadasIguales,
    duplicadasDistintas,
  };
}

const SQL_UPSERT = `
  MERGE [controlhorario].[fichadas] WITH (HOLDLOCK) AS destino
  USING OPENJSON($1)
    WITH (
      [dni] nvarchar(32) '$.dni',
      [fecha] date '$.fecha',
      [payload] nvarchar(max) '$.payload'
    ) AS origen
  ON destino.[dni] = origen.[dni] AND destino.[fecha] = origen.[fecha]
  WHEN MATCHED AND destino.[payload] <> origen.[payload] THEN
    UPDATE SET [payload] = origen.[payload], [carga_id] = $2
  WHEN NOT MATCHED THEN
    INSERT ([dni], [fecha], [payload], [carga_id])
    VALUES (origen.[dni], origen.[fecha], origen.[payload], $2)
  OUTPUT $action AS [accion];
`;

async function escribirLote(
  cliente: PoolClient,
  lote: readonly FilaPreparada[],
  cargaId: number,
): Promise<{ nuevas: number; actualizadas: number }> {
  const { rows } = await cliente.query<{ accion: 'INSERT' | 'UPDATE' }>(SQL_UPSERT, [
    JSON.stringify(lote),
    cargaId,
  ]);
  return {
    nuevas: rows.filter((r) => r.accion === 'INSERT').length,
    actualizadas: rows.filter((r) => r.accion === 'UPDATE').length,
  };
}

/**
 * The historial, optionally narrowed to a set of sectors.
 *
 * The ORDER BY is the same in both branches and it is part of the contract: the screens read
 * the rows in upload order, and a scoped operator must see their days in the same sequence
 * an unscoped one does. Exported so the filter can be asserted without a database.
 */
export function sqlListarFichadas(alcance: AlcanceSectores): ConsultaSql {
  const orden = 'ORDER BY [carga_id], [dni], [fecha]';
  if (alcance === null) {
    return {
      texto: `SELECT [payload] FROM [controlhorario].[fichadas] ${orden}`,
      valores: [],
    };
  }
  return {
    texto:
      `SELECT [payload] FROM [controlhorario].[fichadas]` +
      ` WHERE ${filtroDeSector("JSON_VALUE([payload], '$.Sector')", 1)} ${orden}`,
    valores: [valorDeAlcance(alcance)],
  };
}

export interface RepositorioFichadasAzureSql {
  /**
   * `alcance` is required and not optional on purpose: a call site that forgets it would
   * hand an encargado the whole company, and a parameter with a default is a parameter
   * somebody forgets. `null` is how a caller says "everything", out loud.
   */
  listar(alcance: AlcanceSectores): Promise<readonly FilaQuickpass[]>;
  upsert(filas: readonly FilaQuickpass[], carga: DatosCarga): Promise<ResultadoGuardado>;
  vaciar(actor: string): Promise<number>;
  alcanzable(): Promise<boolean>;
}

export function crearRepositorioAzureSql(pool: Pool): RepositorioFichadasAzureSql {
  return {
    async listar(alcance) {
      const consulta = sqlListarFichadas(alcance);
      const { rows } = await pool.query<{ payload: FilaQuickpass }>(
        consulta.texto,
        consulta.valores,
      );
      return rows.map((r) => r.payload);
    },

    async upsert(filas, carga) {
      const preparacion = prepararFilas(filas);
      return enTransaccion(pool, async (cliente) => {
        const { rows: cargas } = await cliente.query<{ id: number }>(
          `INSERT INTO [controlhorario].[cargas] ([archivo], [subido_por], [filas])
           OUTPUT inserted.[id]
           VALUES ($1, $2, $3)`,
          [carga.archivo, carga.subidoPor, preparacion.filas.length],
        );
        const cargaId = cargas[0]?.id;
        if (cargaId === undefined) throw new Error('El INSERT en cargas no devolvió un id.');

        let nuevas = 0;
        let actualizadas = 0;
        for (let i = 0; i < preparacion.filas.length; i += TAMANO_LOTE) {
          const conteo = await escribirLote(
            cliente,
            preparacion.filas.slice(i, i + TAMANO_LOTE),
            cargaId,
          );
          nuevas += conteo.nuevas;
          actualizadas += conteo.actualizadas;
        }

        const sinCambiosEnBase = preparacion.filas.length - nuevas - actualizadas;
        const { rows: totales } = await cliente.query<{ n: number }>(
          'SELECT CAST(COUNT_BIG(*) AS int) AS [n] FROM [controlhorario].[fichadas]',
        );
        const resultado: ResultadoGuardado = {
          recibidas: filas.length,
          descartadas: preparacion.descartadas,
          nuevas,
          actualizadas: actualizadas + preparacion.duplicadasDistintas,
          sinCambios: sinCambiosEnBase + preparacion.duplicadasIguales,
          totalHistorial: totales[0]?.n ?? 0,
        };

        await cliente.query(
          `INSERT INTO [controlhorario].[auditoria]
             ([actor], [accion], [entidad], [entidad_id], [datos])
           VALUES ($1, N'carga', N'cargas', $2, $3)`,
          [carga.subidoPor, String(cargaId), JSON.stringify(resultado)],
        );
        return resultado;
      });
    },

    async vaciar(actor: string) {
      return enTransaccion(pool, async (cliente) => {
        const { rowCount } = await cliente.query('DELETE FROM [controlhorario].[fichadas]');
        await cliente.query(
          `INSERT INTO [controlhorario].[auditoria]
             ([actor], [accion], [entidad], [entidad_id], [datos])
           VALUES ($1, N'vaciar_historial', N'fichadas', NULL, $2)`,
          [actor, JSON.stringify({ borradas: rowCount })],
        );
        return rowCount;
      });
    },

    async alcanzable() {
      try {
        await pool.query('SELECT 1 AS [ok]');
        return true;
      } catch {
        return false;
      }
    },
  };
}
