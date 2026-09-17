# Despliegue del piloto

## Límite de esta etapa

Esta etapa reutiliza la Azure SQL existente y no crea recursos de Azure. Sólo incorpora el
esquema `[controlhorario]`. La API y el almacenamiento definitivo de adjuntos se despliegan
después de comprobar el flujo funcional.

## Base compartida

Antes de ejecutar DDL, confirmar que el motor y la base sean los correctos, que no exista
un esquema `controlhorario` y que la identidad administradora pueda crear esquemas y roles.

Primero ejecutar `db:preflight` con la identidad administradora para confirmar que el nombre
`controlhorario` esté libre. Después ejecutar `db/bootstrap/000_esquema_y_rol.sql` con esa
identidad y mantenerla únicamente para `db:verify` y `db:migrate`. Al finalizar, crear el
usuario contenido de la API por un canal seguro y ejecutar:

```sql
ALTER ROLE [controlhorario_app] ADD MEMBER [NOMBRE_DEL_USUARIO];
```

No agregar ese usuario a `db_owner`, `db_datareader` ni `db_datawriter`: esos roles le
darían acceso a objetos ajenos. El bootstrap concede sólo lectura y escritura sobre
`SCHEMA::[controlhorario]`.

Con las variables `DB_*` administrativas cargadas sólo para esta instalación:

```powershell
npm.cmd run build:api
npm.cmd run db:preflight
npm.cmd run db:bootstrap
npm.cmd run db:verify
npm.cmd run db:migrate
npm.cmd run db:inspect
npm.cmd run db:smoke
```

`db:verify` ejecuta los mismos archivos y revierte todo. Sólo correr `db:migrate` si esa
validación termina bien. Al finalizar, eliminar esas credenciales del entorno y configurar
la API con el usuario miembro de `controlhorario_app`.

## Configuración

Usar `.env.example` como inventario. Los secretos deben guardarse en la configuración
segura de la API, nunca en Vercel ni en el bundle. La conexión fuerza cifrado y valida el
certificado. `DB_MAX_CONEXIONES=5` mantiene una presión conservadora sobre la base.

En Vercel configurar `VITE_API_BASE_URL=https://URL-DE-LA-API/api`. No colocar allí ninguna
variable `DB_*`. La API debe autorizar exactamente el dominio de producción mediante
`APP_ORIGEN_FRONTEND`; los previews no deben apuntar a producción.

## Verificación posterior

Comprobar `/health`, iniciar sesión, cargar un archivo pequeño, revisar historial y ausencia,
y descargar un adjunto de prueba. En la base, listar los objetos y permisos propios:

```sql
SELECT s.name AS esquema, o.name, o.type_desc
FROM sys.objects o
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE s.name = N'controlhorario'
ORDER BY o.type_desc, o.name;

SELECT DISTINCT OBJECT_SCHEMA_NAME(major_id) AS esquema, permission_name
FROM sys.database_permissions
WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(N'controlhorario_app')
  AND class_desc = N'SCHEMA';
```

Para pasar a una base propia, se ejecutan las mismas migraciones, se copian únicamente los
objetos del esquema `controlhorario` y se cambian las variables `DB_*`.
