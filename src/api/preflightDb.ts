/** Read-only preflight for the shared Azure SQL database. Never creates or alters objects. */

import { leerConfiguracion, ErrorConfiguracion } from './config.js';
import { crearPool } from './db.js';

interface EstadoBase {
  base: string;
  usuario: string;
  edicion_motor: number;
  es_azure_sql: boolean;
  schema_id: number | null;
  objetos_controlhorario: number;
  ledger_existe: boolean;
  puede_crear_schema: boolean;
  es_db_owner: boolean;
}

async function main(): Promise<void> {
  const config = leerConfiguracion();
  const pool = crearPool(config);
  try {
    const { rows } = await pool.query<EstadoBase>(`
      SELECT
        DB_NAME() AS [base],
        USER_NAME() AS [usuario],
        CONVERT(int, SERVERPROPERTY('EngineEdition')) AS [edicion_motor],
        CONVERT(bit, CASE WHEN CONVERT(int, SERVERPROPERTY('EngineEdition')) IN (5, 8)
                         THEN 1 ELSE 0 END) AS [es_azure_sql],
        SCHEMA_ID(N'controlhorario') AS [schema_id],
        (SELECT CONVERT(int, COUNT_BIG(*))
           FROM sys.objects
          WHERE [schema_id] = SCHEMA_ID(N'controlhorario')
            AND [is_ms_shipped] = 0) AS [objetos_controlhorario],
        CONVERT(bit, CASE WHEN OBJECT_ID(N'[controlhorario].[schema_migrations]', N'U')
                         IS NULL THEN 0 ELSE 1 END) AS [ledger_existe],
        CONVERT(bit, HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'CREATE SCHEMA'))
          AS [puede_crear_schema],
        CONVERT(bit, CASE WHEN IS_ROLEMEMBER(N'db_owner') = 1 THEN 1 ELSE 0 END)
          AS [es_db_owner];
    `);
    const estado = rows[0];
    if (!estado) throw new Error('Azure SQL no devolvió el estado de la base.');

    process.stdout.write(
      `${JSON.stringify({
        base: estado.base,
        usuario: estado.usuario,
        azureSql: Boolean(estado.es_azure_sql),
        esquemaControlHorarioExiste: estado.schema_id !== null,
        objetosControlHorario: Number(estado.objetos_controlhorario),
        ledgerMigracionesExiste: Boolean(estado.ledger_existe),
        puedeCrearEsquema: Boolean(estado.puede_crear_schema),
        esDbOwner: Boolean(estado.es_db_owner),
      }, null, 2)}\n`,
    );

    if (!estado.es_azure_sql) throw new Error('La conexión no apunta a Azure SQL Database.');
    if (estado.schema_id !== null && !estado.ledger_existe) {
      throw new Error(
        'El esquema [controlhorario] ya existe pero no tiene un ledger reconocido. No se aplicará nada sin revisar su origen.',
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  const prefijo = e instanceof ErrorConfiguracion ? 'Configuración inválida' : 'Preflight fallido';
  process.stderr.write(`${prefijo}: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
