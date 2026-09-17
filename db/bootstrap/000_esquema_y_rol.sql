-- Bootstrap administrativo para la base Azure SQL compartida.
--
-- No crea logins ni contiene contraseñas. El administrador crea un usuario contenido o un
-- usuario de Entra por un canal seguro y luego lo agrega al rol [controlhorario_app].
-- Ejecutar una sola vez con una identidad que pueda crear esquemas y roles.

SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF SCHEMA_ID(N'controlhorario') IS NULL
  EXEC(N'CREATE SCHEMA [controlhorario] AUTHORIZATION [dbo]');

IF DATABASE_PRINCIPAL_ID(N'controlhorario_app') IS NULL
  CREATE ROLE [controlhorario_app] AUTHORIZATION [dbo];

GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::[controlhorario] TO [controlhorario_app];

COMMIT TRANSACTION;

-- Después de crear el usuario de aplicación, asociarlo sin darle db_datareader,
-- db_datawriter ni permisos sobre [dbo]:
--
--   ALTER ROLE [controlhorario_app] ADD MEMBER [NOMBRE_DEL_USUARIO];
--
-- Verificación de aislamiento (debe listar sólo el esquema controlhorario):
--
--   SELECT DISTINCT OBJECT_SCHEMA_NAME(major_id) AS esquema, permission_name
--   FROM sys.database_permissions
--   WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(N'controlhorario_app')
--     AND class_desc = N'SCHEMA';
