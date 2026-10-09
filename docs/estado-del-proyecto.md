# Estado del proyecto y continuidad

Actualizado: 9 de octubre de 2026.

Este documento permite continuar el trabajo sin depender del historial de una conversación.
Antes de actuar, comprobar siempre `git status`, `git log -5` y el estado real de producción.

## Búsqueda por persona y sector (preparada para publicación, 2026-10-09)

- Notificaciones, Horas e Indicador comparten búsqueda por nombre o DNI y filtro por sector,
  combinados. La búsqueda ignora mayúsculas y acentos; el DNI admite puntos y guiones.
- Los sectores corresponden a los datos disponibles del período; «Sin sector» es una opción
  distinta de «Todos». Si el sector elegido desaparece al cambiar período, se identifica
  como sin datos y se puede recuperar la vista con «Limpiar filtros».
- Se muestra la cantidad de personas visibles sobre el total y se distingue una búsqueda
  sin coincidencias de un período sin registros. Indicador suma únicamente lo visible.
- Horas exporta y despliega únicamente las semanas visibles. Notificaciones prepara sólo
  personas/días visibles: cambiar un filtro limpia la selección, y cambiar período descarta
  días que dejaron de estar disponibles para que no reaparezcan seleccionados al volver.
- No cambia cálculos, contratos, API ni base de datos. El alcance reversible es la barra
  compartida `src/ui/personas`, su integración en estas tres vistas y las pruebas asociadas.

Verificación: typecheck, 699 pruebas (50 archivos) y build correctos. Las 18 pruebas nuevas
cubren normalización, combinación de filtros, limpieza, sector ausente en otro período,
vistas vacías, operaciones visibles y totales. Smoke local con tres personas ficticias:
búsqueda con/sin acentos y DNI sin separadores, filtros combinados sin coincidencias,
selección masiva seguida de cambio de filtro sin selecciones ocultas, Limpiar, total de
Indicador de 24 a 8 al filtrar Oficina, y CSV descargado con sólo la persona visible.

## Mejoras de usabilidad (publicadas, 2026-10-09)

- Notificaciones, Horas, Indicador y Ausencias sustituyen las tablas por un estado de carga
  o un error de consulta del historial con Reintentar. Los contadores del menú se ocultan
  mientras no hay una lectura válida; no presentan un cero como resultado confirmado.
  Un fallo al refrescar el historial tras una importación también bloquea estas vistas.
- La columna semanal y el CSV dicen «Trabajadas + justificadas». El cálculo no cambió:
  siguen sumando presencia y horas justificadas antes de compararlas con el turno semanal.
- «Documentos preparados» reemplaza «Panel de envío». Los chips, Indicador y el historial
  hablan de «Documento generado», y aclaran que generar el Word no confirma entrega al
  empleado. Sólo cambian textos: contratos, marcas históricas y persistencia siguen iguales.
- La acción individual de Notificaciones usa los días seleccionados de esa persona,
  exactamente como la masiva. Sin días elegidos queda deshabilitada; con selección parcial
  indica la cantidad, y con todos indica «Agregar todos». El botón de cada día sigue
  preparando únicamente ese día.

Entrega publicada en Vercel desde main, commit `3fd9b7b`, con despliegue confirmado. No requiere migración ni cambios de API.
Las regresiones automatizadas cubren el bloqueo de tablas ante error/carga con registros
anteriores, la recuperación a la vista vacía válida y la selección vacía/parcial/completa.
La revisión posterior corrigió también el total de documentos generados en Indicador:
si falla la lectura de marcas, tanto las filas como el total ocultan el cero o valor anterior.
Cinco casos de renderizado cubren error, carga y lectura válida (incluido cero confirmado).
Verificación final: typecheck, 681 pruebas (48 archivos) y build correctos. Smoke local con
tres registros ficticios: seleccionar 15 y 17 de septiembre de 2026 prepara dos días y cinco
faltas; generar Word y abrir el historial conserva sólo esas dos fechas. La comprobación
de interfaz autenticada en producción confirmó Horas con datos reales y «Trabajadas + justificadas»,
e Indicador con «Con documento generado» sin alertas de lectura. No se emitieron documentos
reales ni se validaron todos los recorridos de producción.

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
- Pantalla Notificaciones: agrupación por persona y preparación de documentos, individual, masiva y por
  día con falta desde el detalle de la persona; selección de varios días, incluso no
  consecutivos (ver «Notificación por día» y «Selección de días específicos»).
- Pantalla Indicador: faltas por clase y totales del período, sobre la misma agrupación, con
  el total de faltas y el total de faltas notificadas por persona (ver «Faltas notificadas»).
- Registro de faltas notificadas: generar un Word marca sus faltas como notificadas (ver
  «Faltas notificadas»). Usa la migración 005, aplicada el 2026-10-01.
- Horas trabajadas: detalle por día con las fichadas, «Desplegar todas» y clasificación del
  motivo de cada ausencia desde el detalle (ver «Horas trabajadas»).
- Mini-calendario en el header para elegir un rango Desde/Hasta en dos clicks (ver «Rango
  elegido en el calendario»).
- Tardanzas perdonadas por semana: un parámetro de Configuración que perdona las primeras N
  tardanzas de cada persona en cada semana de lunes a domingo (ver «Tardanzas perdonadas por
  semana»).
- Frontend y API desplegados; seis migraciones aplicadas (ver «Migraciones y base
  compartida»).

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

### Notification queue and history

The current checkout replaces direct Word downloads with a shared RRHH queue. All three
selection paths (person, one day, selected days across people) prepare immutable snapshots.
`agruparFaltasPorPersona` remains the sole grouping and `clavesNotificadas` the sole key
builder. Preparation and discard do not mark any fault as notified.

- `/envios`: persistent queue independent of the global period; inspect included days,
  discard individual documents, or generate all visible pending documents in one Word file.
  The panel explicitly states that it preserves the selected content even after evidence or
  configuration changes. Limits: 200 pending documents, 500 rows per document, 5000 queued
  fault keys. Overlapping selections are rejected with an actionable message.
- `/historial-notificaciones`: persisted emitted documents, original issue date, current
  owned marks, downloadable snapshots, and removal of one mark or all marks owned by a
  document. Removal requires an inline confirmation and never deletes the document.
  History contains only emitted documents, at most 50 per page. The previous-notifications
  section was removed at the user's request; legacy marks remain stored and still count in
  Indicador. They no longer contribute empty pages or enable Next. The API refinement was
  deployed on 2026-10-06 (`a39d1312-ad7c-4516-a783-4451ba330076`, `RuntimeSuccessful`),
  with no migration or data deletion; the release commit publishes its frontend on Vercel.
- Both routes and every `/api/envios/*` endpoint are restricted to admin/operator. Encargado
  has neither menu access nor API permission. Panels omit the global period selector.

`src/notificaciones/envios.ts` defines the serializable snapshot, its strict validation,
queue limits and repository port. HTTP and local adapters are composed by
`crearRepositorios`. The SQL adapter uses only `[controlhorario]`; short write transactions
lock the singleton `envios_mutex` row to serialize competing operators. Emission validates
all requested pending IDs, records an idempotency ID and original document date, updates
marks with a new version/document owner, moves every selected item to history and audits
counts/IDs in the same transaction. A missing evidence FK rolls everything back and returns
409 with instructions to discard and prepare again. Missing migration returns 503.

The browser builds Word bytes before committing an emission. A successful commit followed
by a lost response/download is recoverable from history; retrying the same emission ID does
not create another emission or restore subsequently removed marks. Generating a new document
for an already-notified fault transfers its current mark to the newest document. Thus an old
document with no owned mark is not necessarily a manually undone notification. Removal
compares the exact mark version, so stale history cannot remove a later notification.
`NotificadasProvider` invalidates in-flight reads synchronously and reloads authoritative
marks after emission/removal, instead of unioning a session overlay that could resurrect
removed marks. History downloads do not change marks.

Local mode stores queue/history/marks in one `localStorage` value, imports the old marks once,
and uses one atomic write per transition. Web Locks serialize browser-tab writes where
available; callback failures release the lock. If storage writes fail, the previous persisted
state remains intact. Local data are browser-specific, as elsewhere in the app.

#### Release requirements and validation boundary

Migration `006_panel_envios.sql` was **applied to production on 2026-10-06**, before the new
API and frontend. It creates `envios_mutex`, `emisiones`, `documentos_notificacion` and adds
version/document ownership to existing marks. Documents/emissions deliberately have no FK to
imported fichadas, so clearing/replacing evidence cannot erase the document history. Existing
mark-to-fichada cascade behavior remains. Runtime needs only its existing schema DML grants.
`db:inspect` now expects six migrations and the new tables.

Use the existing release procedure: build API, `db:verify`, apply migration with authorized
administrative access and exact-IP temporary firewall, remove that rule in `finally`, inspect
schema, deploy API, then frontend. No credentials belong in source or logs.

Automated tests cover local persistence, exact selection, overlapping preparation, discard,
idempotent retries, stale mark removal, quota failure, legacy marks, snapshot roundtrip,
route validation/roles, SQL transaction boundaries, audit and rollback. SQL tests use doubles:
they do **not** prove execution against Azure SQL. The real migration passed verification with
rollback, application and metadata inspection: 19 tables, six migrations, no external SQL
dependencies or foreign keys, and unchanged schema-only runtime DML permissions. The exact-IP
rule added manually by the user was removed in `finally`; all five older rules remain.
API deployment `3b2573f4-b0ee-4f82-8e9b-439e6b1058d0` completed with `RuntimeSuccessful`
on 2026-10-06. The three compiled API entry/repository/route modules match the local build
by SHA256, and health reports database connectivity and six migrations. The release commit
publishes the frontend through Vercel.
Authenticated mutation smoke tests remain pending. Required smoke flow: prepare multiple people/days,
reload, discard one, generate all, verify exact marks in Indicador, download from history,
remove a mark, then verify it remains removed after reload and that the document survives.

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

La columna «Total» pasó a llamarse «Total faltas» y a su lado está «Notificadas»:
`notificadasDelPeriodo(personas, notificadas)` cuenta, con `contarNotificadas` de
`porDia.ts`, las **filas** de falta de cada persona cuya clave está en el conjunto del
provider. Filas y no claves, para que esté en la misma escala que «Total faltas» y nunca lo
supere. Es una **intersección con las faltas actuales**: una falta notificada que una
corrección de reglas borró después no se cuenta, aunque la tabla la conserve como historia.
La fila «Total período» suma también las notificadas. El estado de notificación se compone
al lado de `NotificacionPersona` y no se le agrega ningún campo, porque ese tipo llega al
generador puro del Word.

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

## Reactivating a retired absence reason

Adding a retired reason's label now reactivates its existing row and preserves its id and
historical references. The selected `worked` flag is applied, just as when editing an active
reason. Previously, retirement set `activo = 0` but creation always inserted a row, violating
the label's unique constraint even though the reason was hidden from Configuración.

`crearMotivo` takes the existing allocation lock before updating a matching inactive label;
if no retired row matches, it follows the existing insert path. Active duplicates remain
rejected. Reactivation and its `motivo_reactivado` audit share one transaction. The existing
POST route still refreshes inferred absences and returns the restored reason to the UI.
No migration is needed. Configuration now explains that adding the same name restores it.

The local adapter retains retired reasons as private `motivosRetirados` storage metadata;
new ids include that history, and public configuration only exposes active reasons. Existing
browser configuration without that field remains readable. Reasons physically removed by
an older local version cannot have their former identity recovered.

Regression coverage includes reactivation with the original id, the selected `worked` flag,
new labels, active duplicate rejection, audit rollback, browser reloads and older storage.
SQL tests record statements and transaction boundaries; they do not execute Azure SQL.
API publication completed on 2026-10-06 with deployment
`d6d1a2e2-d477-49b8-8b12-53d2a00d2ce3`: Azure reported `RuntimeSuccessful`, one successful
instance and zero failures. Kudu's compiled configuration repository SHA256 matches the
local build. Public health reports the database reachable with five migrations; unauthenticated
configuration requests still return 401. The same commit publishes the frontend through
Vercel. An authenticated create/retire/recreate smoke check remains pending because the
available browser session shows the login screen.

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

## Tardanzas perdonadas por semana

Cuarto parámetro de Configuración, al lado de «Tolerancia de tardanza (minutos)»: **cuántas
tardanzas se le perdonan a cada persona por semana**. Entero de 0 a 7, por defecto 1; 0 no
perdona ninguna. No tiene equivalente en el legacy.

Semántica:

- La semana es la semana calendario de lunes a domingo, la misma `RegistroDia.inicioSemana`
  que usa Horas trabajadas. Se agrupa por `dni|inicioSemana`.
- Se perdonan las primeras N faltas `tardanza` de cada persona-semana en orden cronológico
  (fecha del día; a igual fecha, la celda cruda y después la posición, para que sea
  determinista). Sólo cuentan las tardanzas que ya superaron la tolerancia; las demás clases de
  falta no se tocan ni consumen el cupo. Un día sin fecha no tiene semana y nunca se perdona.
- **Se calcula sobre todo el historial, nunca sobre el período elegido.** Si se calculara sobre
  el período, uno que empieza un miércoles volvería a perdonar la tardanza del miércoles aunque
  el lunes ya hubiera usado el cupo, y el mismo día sería falta en una pantalla y perdonado en
  otra según el filtro.

Dónde se aplica: en **un solo punto**, `HistorialProvider`, como post-proceso de los registros
del día: `perdonarTardanzas(registros, n)` (`src/domain/fichadas/perdon.ts`, pura) recibe el
arreglo completo que sale de `construirRegistroDia`. No es un conteo: la tardanza perdonada se
**saca de `RegistroDia.faltas`**, así que `agruparFaltasPorPersona` (que sigue siendo la única
agrupación por persona), el contador de la barra lateral, Notificaciones, el Word, el Indicador
y Horas quedan consistentes sin saber nada nuevo. Para no ocultarla, queda en el campo opcional
`RegistroDia.tardanzaPerdonada`, y el detalle de Horas trabajadas la muestra como su detalle
seguido de « (perdonada)», en tono neutro si es lo único del día (`estadoDelDia` en
`horas.ts`). `construirRegistroDia` no lee el parámetro: un día suelto no puede saber si es la
primera tardanza de su semana. El servidor lo devuelve en `paraElMotor()`, pero la
sincronización de ausencias no depende de las tardanzas.

**Cambia los números al desplegar.** Con el valor por defecto 1, el Indicador y Notificaciones
muestran una tardanza menos por persona y semana desde el primer render. «Notificadas» sigue
siendo una intersección con las faltas actuales: una tardanza ya notificada que ahora queda
perdonada deja de contarse ahí, aunque la tabla de notificadas la conserve como historia.

**Sin migración.** `configuracion` es una tabla clave/valor: la clave
`tardanzas_perdonadas_semana` no tiene fila sembrada, el valor por defecto de
`PARAMETROS_POR_DEFECTO` cubre su ausencia y el `MERGE` de `guardarParametros` inserta la fila
la primera vez que alguien la guarda. `ESQUEMA_CUERPO_PARAMETROS` la acepta como
`integer` 0..7 y sigue con `additionalProperties: false`.

**El guardia HTTP es indulgente con este campo.** `leerParametros`
(`repositorioConfiguracionHttp.ts`) completa `tardanzasPerdonadasSemana` con el valor por
defecto si la respuesta no lo trae, y sólo rechaza un valor presente que no sea número. El
motivo es el orden de despliegue: Vercel publica el frontend en cada push a `main` y la API se
despliega a mano después; con el guardia estricto, la lectura de la configuración fallaría
entera contra la API vieja. En esa ventana, **guardar** el campo contra la API vieja responde
400 (el esquema viejo no lo conoce): conviene desplegar la API antes de cambiar el valor.
Así se publicó el 2026-10-02: primero la API (deployment `f77791b2`) y después `main`; la
pantalla y Horas se verificaron en producción con una sesión real.

El adaptador local tenía un merge superficial: un `parametros` guardado por una versión
anterior reemplazaba los valores por defecto enteros y el campo nuevo llegaba `undefined`.
Ahora `parametros` se combina un nivel más adentro (`{ ...inicial.parametros,
...guardada.parametros }`).

En la pantalla, `CampoParametro` ganó `entero?: boolean`: con él un decimal se descarta igual
que cualquier valor inválido. Los tres campos anteriores no cambian.

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

El baseline esperado es **681 pruebas en 48 archivos**. Las mejoras de usabilidad sumaron 20 casos: 12 estados de lectura, 5 contadores de Indicador y 3 selecciones individuales. La selección de días específicos
sumó 8 en `src/ui/features/notificaciones/notificaciones.test.ts`: fechas no consecutivas
excluidas tanto del XML del Word como del registro, casillas de persona completa/parcial,
último día destildado, independencia por persona y cambios de período con el mismo DNI.
Las tardanzas perdonadas por semana
sumaron 34 sobre las 577 en 41, con dos archivos nuevos: 13 en
`src/domain/fichadas/perdon.test.ts` (0 y valores inválidos como identidad, cupo de 1 y de 2,
cupo propio por semana y por persona, el domingo en la semana del lunes anterior, las otras
clases intactas, tardanza más descanso, la perdonada expuesta sin mutar la entrada, orden
cronológico con entrada desordenada y días sin fecha) y 7 en
`src/ui/configuracion/repositorioConfiguracion.test.ts` (el guardia indulgente con una API
vieja, el cero, el valor presente no numérico, y el merge profundo del adaptador local). Además
8 en `rutasConfiguracion.test.ts` (acepta 0, 1 y 7; rechaza 8, -1, 1,5 y texto sin escribir;
la lectura lo devuelve), 4 en `horas.test.ts` (el estado del día con « (perdonada)») y 2 en
`agrupacion.test.ts` (una tardanza menos por semana y la independencia del período). Las
faltas notificadas sumaron 47
sobre las 530 en 37, con cuatro archivos nuevos: 22 en `src/api/rutasNotificaciones.test.ts`
(403 para un encargado en las dos rutas, 400 por cuerpo vacío, campo de más, clase
desconocida, fecha QUICKPASS, día irreal y más de 5000; 400 por ventana faltante, invertida,
irreal o de más de 400 días; deduplicación; el 409 de la FK con rollback), 6 en
`src/api/repositorioNotificaciones.test.ts` (el MERGE sólo de inserción, la ventana, la forma
de la auditoría, una transacción con commit y el rollback sin auditar), 7 en
`src/ui/notificaciones/RepositorioNotificaciones.test.ts` (el adaptador local idempotente que
conserva la primera fecha, la ventana, sin almacenamiento, el registro dañado, las ventanas y
los lotes) y 4 en `src/ui/features/notificaciones/notificaciones.test.ts` (registrar antes de
descargar, no descargar si falla, y los chips del día). Además 4 en `porDia.test.ts` (claves
ISO, filas sin fecha salteadas, conteo en filas y claves viejas ignoradas), 3 en
`indicador.test.ts` (incluida una clave notificada que ya no es falta) y 1 en
`aislamientoSql.test.ts` por la migración 005. La notificación por día sumó 16 sobre
las 514 en 35, en dos archivos nuevos: 9 en `src/ui/faltas/porDia.test.ts` (orden de los
días, clases juntas en un día, la suma igual a la persona con las mismas filas, identidad y
legajo, días ilegibles al final, persona limpia sin días, y `clavesNotificadas` sin repetir) y
7 en `src/notificaciones/documentoWordDia.test.ts` (nombre del archivo, `null` sin faltas y la
carta idéntica a la de `generarWord`); `documentoWord.test.ts` no se tocó. El rango elegido en el calendario sumó
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

Aplicadas en producción (las seis; el ledger de `fstrack` cuenta 6 desde el 2026-10-06):

1. `001_initial.sql`
2. `002_acceso_y_decisiones.sql`
3. `003_administracion_usuarios.sql`
4. `004_encargados.sql` — reemplaza `CK_ch_usuarios_rol` para admitir `encargado` y crea
   `[controlhorario].[usuarios_sectores]`.
5. `005_faltas_notificadas.sql` — crea `[controlhorario].[faltas_notificadas]`
   (`dni`, `fecha`, `tipo`, `notificado_por`, `notificado_at`; PK `(dni, fecha, tipo)`, CHECK
   de las tres clases, FK `(dni, fecha)` a `fichadas` con `ON DELETE CASCADE` e índice por
   `fecha`). Aplicada el 2026-10-01, ANTES de desplegar la API y el frontend que la usan: la
   API anterior no la toca y su `/health` sólo informa el conteo. Sin ella, generar un Word
   responde 503 `base_sin_migrar` y no se descarga.

6. `006_panel_envios.sql` — notification queue, durable document/emission history and mark
   ownership/version. Applied on 2026-10-06 after a successful rollback verification.

`db:inspect` expects six migrations and 19 tables; the current compiled inspection passed
against production after migration 006, including schema isolation and runtime role checks.

**Cómo se aplicó la 005**, para la próxima: con `.azure/migrar-entra.mjs` (modos `probe`,
`verify`, `migrate`) sobre `dist-api` recompilado, y un token de Entra en `CH_AZ_SQL_TOKEN`
obtenido con `az account get-access-token --resource https://database.windows.net/`. Dos
cosas que costaron un intento cada una:

- **La identidad.** La administradora de Entra del servidor `fstrack` (grupo
  `fisterrasrl_group`) es `b.merino@fisterragroup.com`. Otra cuenta con permisos sobre los
  recursos de Azure llega al servidor pero la base la rechaza con «Login failed for user
  '<token-identified principal>'». La sesión de `az` tiene que ser la de esa administradora.
- **El firewall.** La IP de la máquina tiene que tener una regla temporal; sin ella el error
  es «Client with IP address … is not allowed to access the server». La crea y la borra una
  persona con permisos, nunca un agente, y se borra en cuanto termina la migración.

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

1. Borrar `dist-api` y ejecutar `npm.cmd run build:api` (tsc no borra los archivos de un
   módulo eliminado) y `npm.cmd run build`.
2. Armar la carpeta runtime con `dist`, `dist-api`, `db/migrations`, `package.json`,
   `package-lock.json` y las `node_modules` de producción **para Linux**: `@node-rs/argon2`
   necesita `@node-rs/argon2-linux-x64-gnu` con su `.node` adentro. Verificar el `.tgz` contra
   el `integrity` de `package-lock.json` antes de instalarlo.
3. Comprimir con `fflate` (rutas con `/`). El `tar.exe` de Windows se cae armando este ZIP y
   deja un archivo parcial; Compress-Archive escribe `\` y Linux no lo extrae bien.
4. Reabrir el ZIP y comprobar raíces, migraciones, el binario de argon2 y que `dist-api`
   coincida con el build.
5. Desplegarlo con `az webapp deploy --resource-group fisterrasrl_group --name
   controlhorario-fisterra --type zip --clean true --restart true --src-path <zip>`. Hace
   falta una cuenta con permisos sobre el App Service; la administradora de la base no los
   tiene.
6. Confirmar con `/health` y con el log del contenedor, no con la salida de la CLI.

**La app no compila en Azure.** Hasta el 2026-10-01 tenía `SCM_DO_BUILD_DURING_DEPLOYMENT=true`
y `ENABLE_ORYX_BUILD=true`: Oryx corría `npm install` y después `npm run build`, que con un
paquete precompilado falla con `tsc: not found`. Los despliegues de septiembre funcionaban sólo
porque ese `npm install` reinstalaba el binario de argon2 que el ZIP no traía. Desde el
2026-10-01 ambas están en `false` y el paquete es lo que corre. Kudu igual empaqueta
`node_modules` en `node_modules.tar.gz` con un `oryx-manifest.toml` al desplegar (el
«NodeProjectOptimizer»), y el contenedor lo extrae al arrancar: es normal, no es Oryx compilando.

**La CLI puede informar un fallo que no ocurrió.** Si el contenedor se cayó poco antes del
despliegue, `az webapp deploy` arrastra ese error y termina con «Site failed to start within 10
mins» aunque el sitio nuevo esté arriba. Lo que vale es la línea «Site is running with
deployment version: <id>» del log docker y el `/health`.

**Cambiar la configuración y desplegar en dos pasos corta el servicio.** Cambiar un app setting
reinicia la app con el paquete que tiene: el 2026-10-01 la versión vieja arrancó sin la
compilación de la que dependía, se cayó, y el servicio estuvo unos 2,5 minutos abajo hasta que
el paquete nuevo arrancó. Si hay que cambiar la configuración de compilación, desplegar
inmediatamente después.

## Checklist de reanudación

1. `git status --short --branch`
2. `git log --oneline -5`
3. Leer este documento y `AGENTS.md`.
4. Ejecutar typecheck, pruebas y build antes de modificar.
5. Verificar la pantalla exacta con datos reales, no sólo el placeholder o el HTML inicial.
6. Mantener cada comportamiento con su prueba en un único commit reversible.
7. Tras publicar, confirmar API/SPA y que `main...origin/main` quede limpio.
