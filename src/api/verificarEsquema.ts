/** Verifies the deployed schema by metadata only; it never reads business rows. */

import { leerConfiguracion, ErrorConfiguracion } from './config.js';
import { crearPool } from './db.js';

const TABLAS_ESPERADAS = [
  'adjuntos',
  'auditoria',
  'ausencias',
  'cargas',
  'configuracion',
  'empleados',
  'exclusiones',
  'exclusiones_semilla',
  'fichadas',
  'motivos',
  'schema_migrations',
  'sector_reglas',
  'sesiones',
  'usuarios',
] as const;

async function main(): Promise<void> {
  const pool = crearPool(leerConfiguracion());
  try {
    const [tablas, migraciones, crucesFk, dependencias, permisos, rol] = await Promise.all([
      pool.query<{ name: string }>(`
        SELECT t.[name]
          FROM sys.tables t
         WHERE t.[schema_id] = SCHEMA_ID(N'controlhorario')
         ORDER BY t.[name]`),
      pool.query<{ version: string }>(`
        SELECT [version] FROM [controlhorario].[schema_migrations] ORDER BY [version]`),
      pool.query<{ n: number }>(`
        SELECT CONVERT(int, COUNT_BIG(*)) AS [n]
          FROM sys.foreign_keys fk
          JOIN sys.objects padre ON padre.[object_id] = fk.[parent_object_id]
          JOIN sys.objects referencia ON referencia.[object_id] = fk.[referenced_object_id]
         WHERE SCHEMA_NAME(padre.[schema_id]) = N'controlhorario'
           AND SCHEMA_NAME(referencia.[schema_id]) <> N'controlhorario'`),
      pool.query<{ n: number }>(`
        SELECT CONVERT(int, COUNT_BIG(*)) AS [n]
          FROM sys.sql_expression_dependencies d
         WHERE OBJECT_SCHEMA_NAME(d.[referencing_id]) = N'controlhorario'
           AND d.[referenced_schema_name] IS NOT NULL
           AND d.[referenced_schema_name] <> N'controlhorario'`),
      pool.query<{ permission_name: string; esquema: string | null }>(`
        SELECT p.[permission_name], SCHEMA_NAME(p.[major_id]) AS [esquema]
          FROM sys.database_permissions p
         WHERE p.[grantee_principal_id] = DATABASE_PRINCIPAL_ID(N'controlhorario_app')
         ORDER BY p.[permission_name]`),
      pool.query<{ existe: boolean }>(`
        SELECT CONVERT(bit, CASE WHEN DATABASE_PRINCIPAL_ID(N'controlhorario_app') IS NULL
                                THEN 0 ELSE 1 END) AS [existe]`),
    ]);

    const nombres = tablas.rows.map((r) => r.name);
    const esperadas = [...TABLAS_ESPERADAS];
    const permisosEsperados = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'];
    const permisosReales = permisos.rows.map((p) => p.permission_name);
    const errores: string[] = [];
    if (JSON.stringify(nombres) !== JSON.stringify(esperadas)) errores.push('la lista de tablas no coincide');
    if (migraciones.rows.length !== 3) errores.push('el ledger no contiene las tres migraciones');
    if ((crucesFk.rows[0]?.n ?? -1) !== 0) errores.push('hay claves foráneas hacia otros esquemas');
    if ((dependencias.rows[0]?.n ?? -1) !== 0) errores.push('hay dependencias SQL hacia otros esquemas');
    if (!rol.rows[0]?.existe) errores.push('falta el rol controlhorario_app');
    if (permisos.rows.some((p) => p.esquema !== 'controlhorario')) errores.push('el rol tiene permisos sobre otro esquema');
    if (JSON.stringify(permisosReales) !== JSON.stringify(permisosEsperados)) errores.push('los permisos del rol no son los esperados');

    process.stdout.write(`${JSON.stringify({
      tablas: nombres,
      migraciones: migraciones.rows.map((m) => m.version),
      clavesForaneasExternas: crucesFk.rows[0]?.n ?? null,
      dependenciasExternas: dependencias.rows[0]?.n ?? null,
      permisosRol: permisos.rows,
      resultado: errores.length === 0 ? 'aislamiento verificado' : 'falló',
    }, null, 2)}\n`);
    if (errores.length > 0) throw new Error(errores.join('; '));
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  const prefijo = e instanceof ErrorConfiguracion ? 'Configuración inválida' : 'Verificación fallida';
  process.stderr.write(`${prefijo}: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
