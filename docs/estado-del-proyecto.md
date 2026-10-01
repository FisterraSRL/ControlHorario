# Estado del proyecto y continuidad

Actualizado: 1 de octubre de 2026.

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

#### Rango elegido en el calendario

La etiqueta del ancla es un botón que abre un mini-calendario
(`src/ui/components/molecules/Calendario/`, sin dependencias). El primer click fija la fecha
desde, la pista pasa a «Elegí la fecha hasta» y el puntero o el foco de teclado previsualizan la
banda; el segundo click fija la fecha hasta y cierra. Si el segundo día es anterior se invierten,
y el mismo día dos veces es un rango de un día. Esc y un click afuera cierran sin cambiar nada.

- **Modelo.** `Periodo` es una unión discriminada: `PeriodoPreset { modo, ancla }` para
  `dia`/`semana`/`mes`/`anio` y `PeriodoRango { modo: 'rango', desde, hasta }`. Todo `switch`
  sobre `modo` tiene que decidir qué hace con un rango; `rangoDelPeriodo` lo devuelve tal cual,
  así que las pantallas y los contadores del menú no cambiaron. `crearRango` es la única forma
  de construirlo: normaliza a medianoche UTC e invierte si hace falta.
- **Flechas.** Un rango se desplaza en bloques de su propio largo (10/09 – 16/09 → 17/09 – 23/09),
  sin repetir días.
- **Cambio de modo.** Desde un rango, elegir un preset lo ancla en la fecha `desde`.
- **Header.** Con un rango no hay segmento activo (`SegmentedControl` acepta `valor: null`) y
  el botón muestra `dd/mm/aaaa – dd/mm/aaaa`; la segunda etiqueta de rango se oculta porque
  repetiría lo mismo.
- **Teclado.** Un único punto de tabulación en la grilla; flechas por día y semana,
  Inicio/Fin al lunes/domingo, RePág/AvPág por mes y con Shift por año, Enter/Espacio eligen.
  El foco vuelve al botón al cerrar con Esc o al elegir. La selección se expone como
  `aria-selected` en la celda y con forma (extremos rellenos, banda, anillo en hoy).
- **UTC.** La grilla se arma con `Date.UTC` y `getUTC*`. `grillaMes.test.ts` corre bajo
  `America/Argentina/Buenos_Aires` y compara cadenas ISO completas: un día construido en hora
  local (03:00Z en UTC-3) falla ahí aunque la máquina esté en UTC.
- **Horas trabajadas.** Un período que no empieza en lunes o no termina en domingo muestra un
  aviso informativo: la primera/última semana queda incompleta y su «Diferencia» se compara
  contra el turno semanal completo, porque `reporteSemanal` usa un turno semanal fijo. El cálculo
  no cambió. `semanasParciales` lee la ventana y no el modo: el preset Mes corta semanas igual
  que un rango elegido a mano (octubre de 2026 empieza un jueves), y lo mismo Día. Sólo Semana,
  o un rango de lunes a domingo, no avisa.

## Funcionalidad terminada

- Login, logout, sesiones revocables, rate limit y cambio de la propia contraseña.
- Roles `admin`, `encargado` y `operador` (ver «El rol encargado»).
- Administración de usuarios: listar, crear, activar/desactivar y restablecer contraseña.
- Carga y persistencia del historial QUICKPASS.
- Configuración de parámetros, reglas por sector, motivos y exclusiones.
- Motivo inferido de la nota QUICKPASS, también por la etiqueta de un motivo creado en
  Configuración (ver «Motivo tomado de la nota QUICKPASS»).
- Registro/clasificación de ausencias y adjuntos, de a un día o en lote (ver «Clasificación en
  lote»).
- Generador de notificaciones Word puro en `src/notificaciones`, con fixtures golden.
- Pantalla Notificaciones: agrupación por persona y descarga del Word, individual y masiva.
- Pantalla Indicador: faltas por clase y totales del período, sobre la misma agrupación.
- Horas trabajadas: detalle por día con las fichadas, «Desplegar todas» y clasificación del
  motivo de cada ausencia desde el detalle (ver «Horas trabajadas»).
- Mini-calendario en el header para elegir un rango Desde/Hasta en dos clicks (ver «Rango
  elegido en el calendario»).
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
faltantes según turno” no forma parte de esta unidad.

Después se sumó al detalle:

- **Desplegar todas / Contraer todas** sobre la tabla. El contenedor guarda un conjunto crudo
  de claves `${dni}|${inicioSemana}`, pero la pantalla sólo ve `abiertasVisibles` (ese conjunto
  intersectado con las semanas del período) y cada alternancia parte de ese derivado: un
  cambio de período no necesita ningún efecto para limpiar claves viejas.
- **Fichadas de cada día**: `RegistroDia.movimientos` en hora de reloj (`fmtReloj`) con las
  horas trabajadas; un franco con fichadas también las muestra; una ausencia dice «Sin
  fichadas» con la nota QUICKPASS. La línea la arma `lineaFichadas` en `horas.ts`.
- **Motivo de cada ausencia** con el mismo desplegable que Ausencias y la misma única
  escritura, `useAusencias().asignarMotivo`. No hay recálculo local: HistorialProvider vuelve
  a derivar los días desde el registro y la semana se actualiza sola. Un motivo inferido de
  la nota QUICKPASS (`partes`) aparece seleccionado; elegir un valor lo vuelve decisión humana.
  Las opciones y el aviso de confirmación viven en `src/ui/ausencias/opcionesMotivo.ts`, que
  ambas pantallas comparten.

La exportación CSV no cambió.

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

Un encargado supervisa uno o más sectores y sólo ve esos. Está terminado de punta a punta.

El alcance no es un filtro de pantalla: viaja en la sesión (`Sesion.sectores`), lo resuelve
`alcanceDeSectores(peticion)` en `src/api/autenticacion.ts` y llega al `WHERE` de cada
consulta a través de `src/api/sectores.ts`. `null` significa «sin restricción» y es de RRHH;
un arreglo vacío significa «nada», nunca «todo». El sector vive dentro del JSON QUICKPASS
(`JSON_VALUE([payload], '$.Sector')`), así que `ausencias` y `adjuntos` lo alcanzan uniéndose
a `fichadas` por `(dni, fecha)`.

Un encargado es de sólo lectura salvo tres cosas: `PUT /api/ausencias/motivo` (y su variante en
lote `PUT /api/ausencias/motivos`) sobre días de sus sectores, los adjuntos de esos mismos días y
su propia contraseña. Todo lo demás —
`POST`/`DELETE /api/fichadas`, las escrituras de configuración y `/api/admin/*` — responde
403 mediante los guardias `SOLO_RRHH` y `SOLO_ADMIN`, que son hooks `onRequest` para que un
cuerpo de 30 MB no se lea antes de rechazarlo.

Su decisión se guarda como `motivo_source = 'encargado'`, que ya estaba previsto en
`CK_ch_ausencias_source` y que el MERGE de sincronización ya protegía de ser pisado por una
recarga.

En el frontend, `src/ui/roles.ts` es la única definición del rol. Antes la unión estaba escrita
cuatro veces, y la copia que importaba era el guardia de `repositorioSesionHttp.ts`: rechaza el
cuerpo entero si no reconoce el rol, y el login lee un cuerpo rechazado como credenciales
incorrectas. Un rol que se agregue ahí y se olvide acá no degrada la interfaz, deja afuera a
una persona con la contraseña correcta y le dice que está mal. `sectores` se lee con
indulgencia fuera del guardia, para que un campo ausente o malformado nunca cause eso.

Qué ve cada rol lo decide el campo `roles` de cada sección en `src/ui/app/navegacion.ts`, del
que salen tanto la barra lateral como los guardias de ruta; la ruta de aterrizaje se deriva de
ahí, así que un encargado cae en `/ausencias` y no en `/carga`, que le respondería 403. La
pantalla de Ausencias es la misma para todos: como el servidor ya entrega las filas recortadas,
`construirVista` arma el selector de sector con lo que recibe y sólo lista los suyos.

`operador` está oculto, no eliminado. El alta ofrece `ROLES_ASIGNABLES` —administrador y
encargado— mientras que `ROLES` sigue completo, porque `rol` tiene `DEFAULT (N'operador')` en
la base, el CLI `crearUsuario` se apoya en ese default y el adaptador local se loguea como uno.
Borrar el miembro de `RolUsuario` dejaría esas cuentas afuera por el guardia de arriba;
`src/ui/roles.test.ts` existe para que eso falle como prueba y no como login.

## Clasificación en lote

La pantalla de Ausencias permite tildar filas y aplicarles un mismo motivo de una vez. Es la
misma decisión que la clasificación de a un día, repetida sobre varios días, y nada en la base
ni en la auditoría las distingue salvo el horario.

```text
PUT /api/ausencias/motivos
{ "dias": [{ "dni": "30111222", "fecha": "05/01/2026" }, ...], "motivoId": 4 | null }
-> 200 { "ausencias": [AusenciaRegistrada, ...] }   // las filas como quedaron, orden (dni, fecha)
```

- Entre 1 y 500 días (`MAX_DIAS_POR_LOTE`, en `esquemas.ts` y espejado en el puerto de la UI).
  `motivoId: null` quita la clasificación. El esquema es nuevo y cerrado; el de un día no se
  ensanchó.
- **Todo o nada.** Una fecha ilegible es 400; un solo día fuera del alcance o sin fichada es el
  mismo 403 `fuera_de_alcance` que da la ruta de un día, con el mismo cuerpo; en ambos casos no
  se escribe nada. Un motivo inexistente viola la FK dentro de la transacción y vuelve como el
  mismo 409 `integridad`.
- El alcance se resuelve con **una** consulta (`permiteLosDias` en `src/api/sectores.ts`: los
  días en un parámetro JSON, `OPENJSON` con `LEFT JOIN` a `fichadas`) y la pertenencia la
  decide el mismo `dentroDelAlcance`. RRHH no consulta nada, igual que con un día.
- Los días repetidos se deduplican por `(dni, fecha)` antes de escribir.
- Una transacción: un `MERGE` por conjunto con las mismas reglas que el de un día (`motivo_source`
  según el rol, `resuelto_por`/`resuelto_at`, limpieza a `NULL`) y una fila de auditoría por día,
  con la misma acción y el mismo `datos` (`motivoId`, `motivoAnterior`, `origen`), insertadas con
  `auditarVarios` en una sola sentencia.

En la pantalla, `AusenciasContainer` guarda la selección cruda como `ReadonlySet<ClaveRegistro>`,
pero lo que se muestra y lo que se envía es `seleccionEfectiva` (`ausencias.ts`): la intersección
con las filas visibles, derivada y no podada en un efecto, igual que en Notificaciones. Así un
filtro, un cambio de período o el propio lote —con «Mostrar solo las sin clasificar», las filas
recién clasificadas salen de la tabla— nunca dejan tildada una fila que la persona ya no ve. La
casilla del encabezado tilda o destilda sólo las visibles y queda indeterminada si hay algunas.
La selección se limpia tras aplicar con éxito y se conserva si falla. «Aplicar» se deshabilita si
el lote no cambiaría ningún motivo (el caso por defecto: «Sin clasificar» sobre filas sin
clasificar) o si supera los 500 días.

`Checkbox` ganó dos props opcionales: `indeterminado` y `etiquetaOculta` (etiqueta sólo para
lectores de pantalla). Las pantallas que ya lo usaban no cambian.

## Motivo tomado de la nota QUICKPASS

Cuando nadie fichó, `clasificarPartes` (`src/domain/fichadas/motivos.ts`) infiere el motivo de
la nota QUICKPASS en dos pasadas, y el orden es la regla:

1. Los patrones fijos de `PARTES_MAP`, el primero que coincide gana. Codifican decisiones de
   liquidación («Recupera Horas» antes que «autorizado») y ninguna etiqueta puede pisarlos.
2. Sólo si ninguno coincidió, las etiquetas de los motivos **activos**: la nota tiene que
   contener la etiqueta como palabra o frase completa, sin distinguir mayúsculas ni acentos
   («Paro» no coincide con «Parodi»). Si nombra varias, gana la etiqueta más larga (la más
   específica); a igual largo, el id menor. La etiqueta nunca se compila como RegExp.

Sin lista de motivos el comportamiento es exactamente el anterior. El resultado sigue siendo
`motivo_source = 'partes'`: es deducido, una carga posterior puede refrescarlo y cualquier
decisión humana lo pisa. Sin cambio de esquema.

**Servidor y pantalla tienen que coincidir.** Ausencias lee el registro persistido y Horas
corre el motor; si derivaran con listas distintas mostrarían motivos distintos para el mismo
día. Por eso:

- `paraElMotor()` del servidor y `GET /api/configuracion` devuelven sólo los motivos con
  `activo = 1`, y ambos lados derivan con esa lista. Un motivo retirado nunca se aplica por
  etiqueta. (Un motivo de fábrica retirado sí sigue saliendo de su patrón fijo, como antes.)
- La sincronización del registro es una sola función, `resincronizarAusencias`
  (`src/api/sincronizacionAusencias.ts`). Corre después de cada carga y también después de
  `POST /api/configuracion/motivos` y `DELETE /api/configuracion/motivos/:id`, antes de
  responder: un día cargado antes de que existiera el motivo queda clasificado, y uno que
  tomó una etiqueta retirada deja de llevarla. El MERGE sólo toca filas `NULL`/`partes`;
  `manual` y `encargado` no cambian. Si falla, se registra (sólo conteos y el error saneado)
  y la escritura del motivo igual responde con éxito. Cambiar `worked` no la dispara.
- La pantalla de Configuración recarga el registro de ausencias tras crear o retirar un
  motivo. El adaptador local deriva con los motivos de la configuración local.

## Marca

`BrandLockup` (`src/ui/components/atoms/BrandLockup/`) es el único logo de la app: lo usan
el menú lateral y el login. Copia la geometría del archivo de marca, **salvo el viewBox**.

El archivo vendorizado `src/ui/tokens/brand/fisterra-lockup-horizontal.svg` declara
`viewBox="0 0 420 100"`, pero en Montserrat a 68 la palabra FISTERRA mide 348 unidades desde
x=140 y termina en 488: un SVG recorta a su viewBox, así que se pierden la A final y media R.
**El archivo oficial tiene el mismo defecto** donde sea que se use como imagen. Se corrige en
el origen (`Assets - Fisterra`) y se vuelve a vendorizar; no se edita acá, porque tiene que
seguir idéntico byte a byte.

El componente agranda la caja hasta 496 y fija el ancho de la palabra con `textLength`, para
que una fuente de reemplazo más ancha se ajuste en vez de desbordar. Además usa
`preserveAspectRatio="xMinYMid meet"` y `align-self: flex-start`: los dos contenedores son
columnas flex, y un ítem flex se estira a lo ancho, que es como el logo del menú terminó
flotando 50px a la derecha del resto. En el login va centrado arriba del panel.

## Pruebas

El baseline esperado es **514 pruebas en 35 archivos**. El rango elegido en el calendario sumó
39 sobre las 475 en 34: 21 en el archivo nuevo
`src/ui/components/molecules/Calendario/grillaMes.test.ts` (grilla de lunes a domingo, la
trampa UTC bajo UTC-3, los dos clicks, la banda, el teclado y los textos), 14 en
`periodo.test.ts` (construcción e inversión del rango, desplazamiento por su largo, cambio de
modo, etiqueta, semanas parciales —también para Mes y Día— y `hoyUTC` a las 22:30 en UTC-3) y 4
en `horas.test.ts` (el aviso de semanas incompletas, incluido el del botón Mes). El motivo tomado de la nota sumó 21
sobre las 454 en 33: la pasada por etiqueta (prioridad de los patrones fijos, acentos y
mayúsculas, palabra completa, la etiqueta más larga, motivo retirado, sin lista), su efecto en
`construirRegistroDia` (origen `partes`, la decisión humana gana, el id 8 sigue levantando
`incompleta`), la sincronización del servidor con los motivos activos en el archivo nuevo
`src/api/sincronizacionAusencias.test.ts`, la re-sincronización al crear/retirar un motivo y
el adaptador local. El detalle de Horas trabajadas sumó 10
sobre las 444 en 32: desplegar/contraer contra las semanas visibles, la línea de fichadas y las
opciones compartidas del motivo. La clasificación en lote sumó 39 sobre
las 405 en 30 que había: la ruta en lote, su constructor SQL y su auditoría, el alcance de varios
días, la selección efectiva y el adaptador local. Antes de eso, el rol encargado había llevado
de 300 en 18 a 405 (69
en `src/api/` —alcance de sesión, constructores SQL con sector, el 403 de una justificación
fuera de alcance, la creación transaccional con sectores y la lista de negación por rol— y 36
en `src/ui/` —los guardias de rol ensanchados, el mapeo rol→secciones con su ruta de
aterrizaje, la validación del alta y el invariante de que `operador` está oculto y no
eliminado). Además de `npm.cmd test`, ejecutar siempre los tres
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
