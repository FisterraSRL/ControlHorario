# Estado del proyecto y continuidad

Actualizado: 17 de septiembre de 2026.

Este documento permite continuar el trabajo sin depender del historial de una conversación.
Antes de actuar, comprobar siempre `git status`, `git log -5` y el estado real de producción.

## Producción

- Repositorio: `https://github.com/FisterraSRL/ControlHorario`
- Frontend: `https://control-horario-indol.vercel.app`
- API: `https://controlhorario-fisterra.azurewebsites.net`
- Health: `https://controlhorario-fisterra.azurewebsites.net/health`
- Azure App Service: `controlhorario-fisterra`
- Resource group: `fisterrasrl_group`
- Azure SQL: servidor `fstrack.database.windows.net`, base `fstrack`, esquema exclusivo
  `[controlhorario]`.

Vercel aloja la SPA para no cargar el App Service. El App Service sirve la API Fastify. La
cookie de sesión es `httpOnly`, `Secure` y `SameSite=None`; CORS acepta únicamente el origen
exacto de Vercel y permite credenciales.

## Arquitectura

```text
Vercel (React/Vite)
        |
        | HTTPS + cookie httpOnly
        v
Azure App Service (Fastify/Node)
        |
        | TLS, usuario contenido con permisos sólo sobre el esquema
        v
Azure SQL fstrack
  └─ controlhorario.*
```

El frontend se organiza por puertos y adaptadores en `src/ui`. `crearRepositorios()` decide
una sola vez entre HTTP y modo local. Los registros diarios se derivan en
`HistorialProvider` usando evidencia, configuración y decisiones de ausencias. El motor de
negocio puro está en `src/domain/fichadas`.

## Funcionalidad terminada

- Login, logout, sesiones revocables, rate limit y cambio de la propia contraseña.
- Roles `admin`/`operador`.
- Administración de usuarios: listar, crear, activar/desactivar y restablecer contraseña.
- Carga y persistencia del historial QUICKPASS.
- Configuración de parámetros, reglas por sector, motivos y exclusiones.
- Registro/clasificación de ausencias y adjuntos.
- Generador de notificaciones Word puro en `src/notificaciones`, con fixtures golden.
- Pantalla Notificaciones: agrupación por persona y descarga del Word, individual y masiva.
- Frontend y API desplegados; tres migraciones aplicadas.

### Decisiones de seguridad relevantes

- Las contraseñas usan Argon2id y nunca se guardan en claro.
- Una contraseña temporal sólo vuelve en la respuesta de creación/restablecimiento.
- Cambiar la propia contraseña exige la actual y revoca las demás sesiones.
- No se puede desactivar la propia cuenta ni dejar el sistema sin un admin activo.
- Las acciones sensibles quedan en `controlhorario.auditoria`, sin contraseña ni datos
  innecesarios.
- Los `bigint` de Azure SQL se representan como texto en la API. El bug que descartaba la
  lista completa de usuarios quedó cubierto por `repositorioUsuariosHttp.test.ts`.

## Slice 2

Las referencias antiguas llaman `slice 2b` a las pantallas Notificaciones, Indicador y
Horas trabajadas. La persistencia que comentarios viejos llaman `slice 2c` ya existe en
Azure SQL; esos comentarios son históricos, no trabajo pendiente.

### Horas trabajadas

La unidad base está implementada y publicada en el commit `1d69de3`:

- agrupación semanal lunes-domingo mediante el motor `reporteSemanal`;
- filtro por período global;
- agrupación visual por sector;
- horas de turno, trabajadas + justificadas, descanso y diferencia;
- aviso de ausencias sin clasificar;
- detalle expandible de cada día;
- exportación CSV con BOM y `;`, compatible con Excel en configuración regional es-AR;
- pruebas del filtro, rango semanal y exportación.

La verificación confirmó typecheck, build, 269 pruebas y que Vercel sirve el bundle nuevo.
Al abrir `/horas` la sesión del navegador había vencido y el portal mostró el login; por eso
queda pendiente una comprobación visual autenticada con datos reales. No usar credenciales
en comandos ni pedirlas en chat para saltear ese paso. El modo legacy “completar fichadas
faltantes según turno” y la clasificación inline desde el detalle no forman parte de esta
primera unidad.

### Notificaciones

Implementada. `NotificacionesContainer` agrupa las faltas del período por persona, permite
selección individual y masiva, y descarga los bytes mediante un object URL que se revoca.
Nada se envía al servidor: el `.docx` se arma en el navegador.

La agrupación NO vive en el feature. Está en `src/ui/faltas/agrupacion.ts`, junto a
`periodo/` e `historial/`:

```ts
agruparFaltasPorPersona(registros, configuracion, rango): readonly NotificacionPersona[]
```

Es la **única** definición de “cantidad de faltas” del sistema, y es deliberado: Indicador la
consume desde ahí, de modo que la pantalla y la carta nunca puedan discrepar sobre cuántas
faltas tiene alguien. Dejarla dentro de `features/notificaciones` habría obligado a
`features/indicador` a importar de un hermano. `src/notificaciones/tipos.ts` declara que la
agrupación es capa UI y no forma parte de ese módulo; ese límite se respeta.

Es un puerto fiel de `groupFaultsByPerson` (`legacy/app.html`, ~líneas 1154-1184), con una
divergencia documentada en el código: las filas sin fecha parseable van al final y no al
principio.

Detalle de TypeScript que no es opcional: `new Blob([bytes])` no compila con TS 5.7, que hizo
`Uint8Array` genérico sobre su buffer. `fflate` devuelve `Uint8Array<ArrayBufferLike>` y
`BlobPart` sólo acepta una vista sobre un `ArrayBuffer` plano. El container lo resuelve en el
helper `comoDocx` con un cast acotado; la alternativa copiaba el documento entero en cada
descarga. El comentario de `src/notificaciones/tipos.ts` que muestra la llamada directa quedó
desactualizado por este motivo.

Verificado en el navegador con datos reales, no sólo con pruebas: los bytes entregados
empiezan con el magic ZIP `50 4b 03 04` y contienen `[Content_Types].xml`, `_rels/.rels` y
`word/document.xml`.

### Indicador (pendiente)

`IndicadorScreen.tsx` sigue siendo placeholder. Debe agregar por persona las tres clases de
falta (`incompleta`, `descanso`, `tardanza`) dentro del período y mostrar totales. Tiene que
importar `agruparFaltasPorPersona` de `src/ui/faltas/` y contar sobre `faltasPorTipo`; no
escribir una segunda agrupación.

## Pruebas

El baseline esperado es **280 pruebas en 16 archivos** (266 antes de Horas, 269 con Horas, y
11 más con `src/ui/faltas/agrupacion.test.ts`). Además de `npm.cmd test`, ejecutar siempre
los tres typechecks y el build de Vite mediante `npm.cmd run typecheck` y `npm.cmd run build`.

Vitest sólo recoge `src/**/*.test.ts` en entorno `node`: una prueba `.tsx` de componente no
se ejecuta nunca. Por eso el valor de prueba de una pantalla vive en su módulo puro.

Vitest excluye deliberadamente:

- `src/api/acceso.test.ts`
- `src/api/decisiones.test.ts`
- `src/api/esquema.test.ts`
- `src/api/origenCruzado.test.ts`

Esas suites pertenecen al adaptador PostgreSQL/PGlite retirado. No presentarlas como pruebas
vigentes. Azure SQL se valida con las migraciones reales (`db:verify`) y smoke checks de
producción. Una prueba que transpila no sustituye al typecheck.

## Migraciones y base compartida

Aplicadas:

1. `001_initial.sql`
2. `002_acceso_y_decisiones.sql`
3. `003_administracion_usuarios.sql`

Nunca abrir el firewall de Azure SQL ampliamente. Crear una regla temporal para la IP
exacta, ejecutar `db:verify` antes de `db:migrate` y eliminar la regla en un bloque `finally`.
Las credenciales administrativas pueden leerse desde configuración local autorizada, pero
no deben mostrarse en la terminal ni persistirse en este repositorio. El usuario runtime
sólo tiene `SELECT`, `INSERT`, `UPDATE` y `DELETE` sobre `SCHEMA::controlhorario`.

## Despliegue

### Frontend

Un push a `origin/main` dispara Vercel. Verificar que el HTML público referencie un asset JS
nuevo y después abrir la ruta afectada. Una pestaña que estaba abierta antes del deploy
puede mantener el bundle viejo: recargarla antes de diagnosticar un fallo.

### Backend

1. Ejecutar `npm.cmd run build:api`.
2. Crear un ZIP precompilado con `dist`, `dist-api`, `db/migrations`, el `package.json`
   runtime y sus dependencias de producción.
3. Desplegarlo con `az webapp deploy --resource-group fisterrasrl_group --name
   controlhorario-fisterra --type zip --clean true --restart true`.
4. Esperar `RuntimeSuccessful` y consultar `/health`.

No depender de que Kudu compile: el paquete usado en producción es precompilado.

## Checklist de reanudación

1. `git status --short --branch`
2. `git log --oneline -5`
3. Leer este documento y `AGENTS.md`.
4. Ejecutar typecheck, pruebas y build antes de modificar.
5. Verificar la pantalla exacta con datos reales, no sólo el placeholder o el HTML inicial.
6. Mantener cada comportamiento con su prueba en un único commit reversible.
7. Tras publicar, confirmar API/SPA y que `main...origin/main` quede limpio.
