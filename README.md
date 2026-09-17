# ControlHorario

Aplicación interna de RRHH para analizar exportaciones QUICKPASS, revisar irregularidades,
registrar ausencias y generar notificaciones. El frontend es una SPA React/Vite y la API es
Fastify sobre Node.js.

## Arquitectura del piloto

```text
Navegador -> Vercel (SPA) -> API Fastify -> Azure SQL compartida
                                      \-> almacenamiento privado de adjuntos
```

La base también contiene Centraliza y FSTrack, pero ControlHorario queda aislado:

- todos sus objetos viven en el esquema `[controlhorario]`;
- todas las consultas usan el nombre de esquema explícito;
- el rol `controlhorario_app` sólo recibe permisos sobre ese esquema;
- no hay claves, vistas ni consultas hacia tablas de los otros proyectos;
- el navegador nunca recibe credenciales de la base.

El piloto crea únicamente estas tablas: `empleados`, `cargas`, `fichadas`, `motivos`,
`ausencias`, `adjuntos`, `exclusiones`, `auditoria`, `usuarios`, `sesiones`,
`configuracion`, `sector_reglas`, `exclusiones_semilla` y `schema_migrations`.

## Desarrollo

```powershell
npm.cmd install
npm.cmd run dev
```

Sin API, la interfaz funciona en modo local para explorar el flujo. Para probar persistencia
real, copiá `.env.example` a `.env`, completá las variables `DB_*` por un canal seguro y
levantá la API:

```powershell
npm.cmd run build:api
npm.cmd run api
```

No pegues contraseñas en commits, capturas ni conversaciones.

## Crear el esquema sin riesgos

El bootstrap administrativo crea sólo el esquema y el rol. No crea usuarios ni contiene
contraseñas:

1. Con las credenciales administrativas cargadas temporalmente en `DB_*`, comprobar primero
   que el nombre esté libre:

   ```powershell
   npm.cmd run build:api
   npm.cmd run db:preflight
   ```

2. Revisar `db/bootstrap/000_esquema_y_rol.sql` y ejecutarlo con esa identidad:

   ```powershell
   npm.cmd run db:bootstrap
   ```
3. Validar las migraciones con rollback automático:

   ```powershell
   npm.cmd run db:verify
   ```

4. Si la verificación termina correctamente, aplicar las migraciones:

   ```powershell
   npm.cmd run db:migrate
   npm.cmd run db:inspect
   npm.cmd run db:smoke
   ```

5. Crear un usuario contenido para la API, agregarlo a `controlhorario_app` y reemplazar
   las credenciales administrativas por las de ese usuario. La cuenta permanente no puede
   crear ni borrar tablas.

Las migraciones están numeradas y guardan checksum. No se deben editar después de
aplicarlas; cualquier cambio posterior va en un archivo nuevo.

## Comprobaciones

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

La integración con Azure SQL se valida con `db:verify`, sobre la base real y dentro de una
transacción descartada. Las pruebas normales no necesitan credenciales.

## Despliegue

- La SPA se construye para Vercel con `vercel.json`.
- `VITE_API_BASE_URL` debe contener la URL HTTPS pública de la API terminada en `/api`.
- La API puede ejecutarse con el `Dockerfile`; las variables de base se inyectan en runtime.
- `API_MIGRAR_AL_INICIAR` permanece en `false`: las migraciones son una acción explícita.
- Los adjuntos requieren almacenamiento persistente privado antes de usar más de una API.

La guía operativa está en `docs/despliegue.md` y el arranque local en
`docs/stack-local.md`.
