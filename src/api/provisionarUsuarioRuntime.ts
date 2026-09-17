/**
 * Creates or rotates the contained Azure SQL user used by the API.
 *
 * The password arrives only through CH_DB_RUNTIME_PASSWORD, is never logged, and is not
 * stored by this script. Run with administrative DB_* credentials, then place the same
 * password in the Web App settings and clear it from the local process environment.
 */

import { leerConfiguracion, ErrorConfiguracion } from './config.js';
import { crearPool } from './db.js';

const USUARIO = 'controlhorario_runtime';

function literalSql(valor: string): string {
  return `N'${valor.replaceAll("'", "''")}'`;
}

async function main(): Promise<void> {
  const contrasena = process.env['CH_DB_RUNTIME_PASSWORD'];
  if (!contrasena || contrasena.length < 32) {
    throw new ErrorConfiguracion('CH_DB_RUNTIME_PASSWORD debe contener al menos 32 caracteres.');
  }

  const config = leerConfiguracion();
  const admin = crearPool(config);
  try {
    const secreto = literalSql(contrasena);
    await admin.query(`
      IF DATABASE_PRINCIPAL_ID(N'${USUARIO}') IS NULL
        CREATE USER [${USUARIO}] WITH PASSWORD = ${secreto}, DEFAULT_SCHEMA = [controlhorario];
      ELSE
        ALTER USER [${USUARIO}] WITH PASSWORD = ${secreto}, DEFAULT_SCHEMA = [controlhorario];

      IF IS_ROLEMEMBER(N'controlhorario_app', N'${USUARIO}') <> 1
        ALTER ROLE [controlhorario_app] ADD MEMBER [${USUARIO}];
    `);
  } finally {
    await admin.end();
  }

  const runtime = crearPool({
    ...config,
    baseDeDatos: {
      ...config.baseDeDatos,
      usuario: USUARIO,
      contrasena,
    },
  });
  try {
    const { rows } = await runtime.query<{
      acceso_propio: boolean;
      acceso_dbo: boolean;
      tablas_externas: number;
    }>(`
      SELECT
        CONVERT(bit, HAS_PERMS_BY_NAME(N'controlhorario', N'SCHEMA', N'SELECT')) AS [acceso_propio],
        CONVERT(bit, HAS_PERMS_BY_NAME(N'dbo', N'SCHEMA', N'SELECT')) AS [acceso_dbo],
        (
          SELECT CONVERT(int, COUNT_BIG(*))
            FROM sys.tables t
            JOIN sys.schemas s ON s.[schema_id] = t.[schema_id]
           WHERE s.[name] <> N'controlhorario'
             AND HAS_PERMS_BY_NAME(
                   QUOTENAME(s.[name]) + N'.' + QUOTENAME(t.[name]),
                   N'OBJECT',
                   N'SELECT'
                 ) = 1
        ) AS [tablas_externas];
    `);
    const verificacion = rows[0];
    if (!verificacion?.acceso_propio || verificacion.acceso_dbo || verificacion.tablas_externas !== 0) {
      throw new Error('El usuario de runtime no quedó aislado al esquema controlhorario.');
    }
    process.stdout.write(
      `${JSON.stringify({ usuario: USUARIO, esquema: 'controlhorario', tablasExternas: 0, resultado: 'aislamiento verificado' })}\n`,
    );
  } finally {
    await runtime.end();
  }
}

main().catch((e: unknown) => {
  const prefijo = e instanceof ErrorConfiguracion ? 'Configuración inválida' : 'Provisionamiento fallido';
  process.stderr.write(`${prefijo}: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
