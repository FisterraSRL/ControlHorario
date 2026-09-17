# Guía para agentes IA

Leé primero [`docs/estado-del-proyecto.md`](docs/estado-del-proyecto.md). Es la fuente de
continuidad: arquitectura, producción, pruebas, despliegue y roadmap.

## Reglas que no se negocian

- La base Azure SQL es compartida con Centraliza y FSTrack. Toda consulta debe calificar
  explícitamente el esquema `[controlhorario]`. No crear dependencias hacia otros esquemas.
- Nunca imprimir, registrar, commitear ni copiar a documentación contraseñas, cookies,
  cadenas de conexión o valores de `.env`/App Settings.
- Las migraciones aplicadas son inmutables. Crear `db/migrations/NNN_*.sql`; no editar
  `001`, `002` ni `003`.
- Los ids `bigint` cruzan JSON como `string`. No volver a exigir `number` en el frontend.
- Las rutas `/api/*` son privadas por defecto mediante el guard global. Sólo `/health` y
  `POST /api/sesion` son públicas.
- No registrar cuerpos, encabezados, DNI, nombres, contraseñas ni nombres de adjuntos.
- Conservar la separación puerto/adaptador: las pantallas no llaman `fetch` directamente.

## Comprobación obligatoria

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

`npm.cmd test` no ejecuta cuatro suites antiguas basadas en PostgreSQL/PGlite. Para el SQL
real se usa `npm.cmd run build:api` seguido por `npm.cmd run db:verify` con credenciales
administrativas cargadas sólo en memoria y una regla temporal de firewall que siempre se
elimina.

## Flujo de entrega

- Un commit por comportamiento utilizable, con sus pruebas y documentación.
- `main` se publica automáticamente en Vercel.
- La API se despliega por ZIP precompilado en el App Service `controlhorario-fisterra` del
  resource group `fisterrasrl_group`.
- Verificar después `/health`, la ruta afectada en producción y `git status --short --branch`.

## Próxima unidad recomendada

Finalizar el slice 2b en este orden:

1. Confirmar/publicar Horas trabajadas y verificarlo con datos reales.
2. Construir Notificaciones usando `src/notificaciones` (el generador Word ya está hecho).
3. Construir Indicador como agregación de faltas por persona.
4. Sólo después evaluar el modo estimado de Horas del legacy.

