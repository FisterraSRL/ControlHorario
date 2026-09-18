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

### El período del header

`crearPeriodo(modo, ancla)` es la única forma de construir un `Periodo`, y garantiza que el
ancla nombre el comienzo de su propia ventana. En modo `semana` el ancla **es** el lunes: la
semana corre lunes a domingo, igual que el motor, y un header que dijera «17 sep 2026» sobre
un rango 14/09 – 20/09 estaría nombrando un día en el que la ventana no empieza. La regla vale
para el arranque de la app, para las flechas de desplazamiento y para volver a `semana` desde
otro modo.

`dia` conserva el día exacto —encajarlo en lunes haría imposible mirar un martes— y `mes`/`anio`
también, porque `etiquetaRango` ya deletrea ambos extremos. El caso que rompe una
implementación ingenua es el domingo, que en `getUTCDay()` es `0` y no `7`: pertenece a la
semana que abrió el lunes anterior. Está cubierto en `src/ui/periodo/periodo.test.ts`.

## Funcionalidad terminada

- Login, logout, sesiones revocables, rate limit y cambio de la propia contraseña.
- Roles `admin`/`operador` y, en la API, `encargado` (ver «El rol encargado»).
- Administración de usuarios: listar, crear, activar/desactivar y restablecer contraseña.
- Carga y persistencia del historial QUICKPASS.
- Configuración de parámetros, reglas por sector, motivos y exclusiones.
- Registro/clasificación de ausencias y adjuntos.
- Generador de notificaciones Word puro en `src/notificaciones`, con fixtures golden.
- Pantalla Notificaciones: agrupación por persona y descarga del Word, individual y masiva.
- Pantalla Indicador: faltas por clase y totales del período, sobre la misma agrupación.
- Frontend y API desplegados; tres migraciones aplicadas.

Ninguna pantalla es ya un placeholder. `src/ui/app/PlaceholderScreen.tsx` quedó sin
importadores; se conserva a propósito, no es código muerto que haya que borrar sin decidirlo.

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
agruparFaltasPorPersona(registros, configuracion, rango, opciones?): readonly NotificacionPersona[]
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

### Indicador

Implementada. `IndicadorContainer` no tiene estado ni efectos: pide
`agruparFaltasPorPersona(registros, paraElMotor, rango, { incluirSinFaltas: true })` y
`totalesDelPeriodo`, y no hay nada que descargar. La pantalla muestra Persona, DNI, las tres
clases de falta y el total, con separadores por sector y una fila final «Total período». Los
encabezados de las tres columnas de falta salen de `META_FALTAS[tipo].label`, así que se leen
igual que los chips de Notificaciones y que los títulos del Word.

`src/ui/features/indicador/indicador.ts` sólo suma: `totalesDelPeriodo` recorre
`ORDEN_FALTAS` y usa `totalDeFaltas`, de modo que el total general de la pantalla y el total
por persona de la carta son la misma función.

#### La opción `incluirSinFaltas`

Cuarto parámetro opcional de `agruparFaltasPorPersona`. Sin él, el comportamiento es
exactamente el de antes: sólo aparece quien tiene al menos una falta, que es lo que
Notificaciones necesita. Con él, también se lista en cero a quien trabajó el período limpio,
que es lo que pide un indicador: un sector vacío y un sector que nadie cargó tienen que poder
distinguirse.

#### Divergencia documentada respecto del legacy

`groupFaultsByPersonAll` (`legacy/app.html`, ~líneas 1288-1298) empezaba con
`if (r.excluded) return; if (r.dayType!=='trabajo') return;` aplicado a **todos** los
registros, y por eso descartaba faltas reales: `src/domain/fichadas/dia.ts` (líneas 108-120)
emite una falta `incompleta` cuando nadie fichó y el parte QUICKPASS dice «olvidó fichar», y
ese día devuelve `tipoDia: 'ausencia'`. Con la regla del legacy esa falta nunca llegaba al
Indicador, de modo que la misma persona aparecía con un número en el Indicador y con otro en
Notificaciones.

Acá el filtro `trabajo`/`excluido` decide **únicamente** si una persona limpia se gana una
fila de ceros; un registro que tiene faltas se procesa siempre, sin filtro nuevo. Las dos
pantallas no pueden discrepar sobre cuántas faltas tiene alguien. Hay una prueba dedicada a
ese caso en `src/ui/faltas/agrupacion.test.ts`.

## El rol encargado

Un encargado supervisa uno o más sectores y sólo ve esos. **La mitad de servidor está hecha;
la de frontend no.**

El alcance no es un filtro de pantalla: viaja en la sesión (`Sesion.sectores`), lo resuelve
`alcanceDeSectores(peticion)` en `src/api/autenticacion.ts` y llega al `WHERE` de cada
consulta a través de `src/api/sectores.ts`. `null` significa «sin restricción» y es de RRHH;
un arreglo vacío significa «nada», nunca «todo». El sector vive dentro del JSON QUICKPASS
(`JSON_VALUE([payload], '$.Sector')`), así que `ausencias` y `adjuntos` lo alcanzan uniéndose
a `fichadas` por `(dni, fecha)`.

Un encargado es de sólo lectura salvo tres cosas: `PUT /api/ausencias/motivo` sobre un día de
sus sectores, los adjuntos de esos mismos días y su propia contraseña. Todo lo demás —
`POST`/`DELETE /api/fichadas`, las escrituras de configuración y `/api/admin/*` — responde
403 mediante los guardias `SOLO_RRHH` y `SOLO_ADMIN`, que son hooks `onRequest` para que un
cuerpo de 30 MB no se lea antes de rechazarlo.

Su decisión se guarda como `motivo_source = 'encargado'`, que ya estaba previsto en
`CK_ch_ausencias_source` y que el MERGE de sincronización ya protegía de ser pisado por una
recarga.

Falta el frontend: `src/ui/sesion/repositorioSesionHttp.ts` sólo acepta `admin` y `operador`,
así que hoy un encargado se autentica contra la API y la SPA descarta la sesión.

## Pruebas

El baseline esperado es **369 pruebas en 26 archivos** (300 en 18 antes del rol encargado; las
69 nuevas están en `src/api/`: alcance de sesión, constructores SQL con sector, el 403 de una
justificación fuera de alcance, la creación transaccional con sectores y la lista de negación
por rol). Además de `npm.cmd test`, ejecutar siempre los tres
typechecks y el build de Vite mediante `npm.cmd run typecheck` y `npm.cmd run build`.

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

Lo que sí se puede probar sin base es lo que es una decisión y no un dialecto: qué `WHERE` se
arma, qué parámetro lleva el alcance, si la ruta rechazó antes de escribir y si dos sentencias
compartieron una transacción. Para eso está `src/api/pruebas/dobles.ts` —un `Pool` que
registra en lugar de ejecutar y una instancia Fastify con la sesión ya puesta—, que no depende
de PGlite y no revive el arnés retirado.

## Migraciones y base compartida

Aplicadas:

1. `001_initial.sql`
2. `002_acceso_y_decisiones.sql`
3. `003_administracion_usuarios.sql`

Escrita y **todavía no aplicada**:

4. `004_encargados.sql` — reemplaza `CK_ch_usuarios_rol` para admitir `encargado` y crea
   `[controlhorario].[usuarios_sectores]`. Hasta aplicarla, `db:inspect` falla a propósito:
   `verificarEsquema.ts` ya espera cuatro migraciones y la tabla nueva. La API tampoco puede
   autenticar a un encargado antes de aplicarla, porque la consulta de sectores leería una
   tabla inexistente.

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
