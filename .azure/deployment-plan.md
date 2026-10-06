# Azure Deployment Plan

> **Status:** Deployed — notification panels API and SQL migration

Generated: 2026-09-16

## Notification panels release — 2026-10-06

The authorized release includes additive migration `006_panel_envios.sql`, the precompiled
API, and the Vercel frontend. Existing target infrastructure and app settings are unchanged.
Do not deploy either application until migration verification, application and schema
inspection succeed. Earlier validated sections below describe previous releases only.

### Preparation evidence

- Implementation handoff: 657 tests in 46 files, typecheck, frontend build and API build passed.
- API rebuilt from a clean, explicitly checked `dist-api` directory for packaging.
- Changed-file secret pattern scan passed across 22 feature/documentation files;
  `git diff --check` passed. Existing untracked local deployment files are preserved.
- Linux argon2 archive integrity matches package-lock; packaged native binary matches the
  archive. Existing production dependency lock is byte-identical to the current lock.
- ZIP `controlhorario-20261006-paneles.zip`: 24,093,099 bytes, 10,273 entries, six migrations;
  readback verified all entries byte-for-byte, the new API modules, safe paths and no env files.
  SHA256: `2c21e9c3740848f5fc61e453194c0f104fb4ccbc6553ec1e11c831f2e22354df`.
- Initial SQL preflight was blocked by the firewall. The user added exact-IP temporary
  access manually; the previously authorized administrative configuration was then loaded
  only into process memory. No credential values were printed or persisted.
- The compiled `db:verify` runner validated migration 006 with rollback (287 ms), then the
  `db:migrate` runner applied it (237 ms). `db:inspect` confirmed 19 tables, six migrations,
  zero external foreign keys/dependencies, and only schema-scoped SELECT/INSERT/UPDATE/DELETE.
- Temporary rule `ClientIPAddress_2026-10-6_9-35-42` was removed in `finally`; absence was
  confirmed and all five pre-existing firewall rules remain.
- API deployment `3b2573f4-b0ee-4f82-8e9b-439e6b1058d0` completed with `RuntimeSuccessful`,
  one successful instance and zero failures. Kudu reports status 4 and active.
- Remote compiled `repositorioEnvios.js`, `rutasEnvios.js` and `servidor.js` each match
  local SHA256. Health confirms database connectivity and six migrations.
- The release commit publishes the frontend through Vercel. Authenticated UI verification
  must avoid creating test business data; mutation smoke testing remains explicitly pending.

## Application-only update — 2026-10-06

Status: Validated for the retired absence reason fix. The current deployment recipe is
Azure CLI ZIP with a precompiled application, superseding the historical Oryx recipe below.
No infrastructure, permissions, app settings or SQL migration changes are included.
The existing subscription, resource group and application remain the authorized target.

### Validation proof — 2026-10-06, 08:03 America/Buenos_Aires

- `npm.cmd run typecheck`: passed; `npm.cmd test`: 628 tests in 44 files passed.
- `npm.cmd run build`: passed; `npm.cmd run build:api`: passed again after removing only
  the verified workspace `dist-api` build directory.
- Azure CLI readback: existing App Service is Running, Linux `NODE|24-lts`, startup
  `npm run api`; `ENABLE_ORYX_BUILD` and `SCM_DO_BUILD_DURING_DEPLOYMENT` are both false.
- Existing target subscription matches the originally approved subscription below.
- Package-lock matches the previously deployed production dependency tree. Linux argon2
  archive SHA512 matches package-lock integrity; packaged binary matches that archive.
- ZIP readback verified all 10,248 entries byte-for-byte, five migrations, forward slash
  paths, no environment files and the compiled reactivation branch.
- Package: `controlhorario-20261006-motivo.zip`, 24,054,250 bytes, SHA256
  `093a57bf57b4279e87bdfdc3057970bb9f57b22bf25463082c256671bb2eeeda`.
- Live preflight `/health`: `ok: true`, database reachable over TLS, five applied migrations.
- No Bicep, Docker, policy, role or schema changes: provisioning validation and migration
  execution do not apply to this application-only update. Real SQL mutation and
  authenticated UI smoke testing have not been performed; the browser has no active session.

### Deployment proof — 2026-10-06

- `az webapp deploy --type zip --clean true --restart true --async true` completed with
  `RuntimeSuccessful`, one successful instance and zero failed instances.
- Deployment id: `d6d1a2e2-d477-49b8-8b12-53d2a00d2ce3`; Kudu reports status 4 and active.
- Remote compiled configuration repository matches local SHA256
  `1D79ACEE1ED71A1D2A69A71D9BA9F49D2AE6360E4255D8DB131C513744849213`.
- API health after restart reports 42 seconds of uptime, database reachable and five
  migrations. Unauthenticated configuration returns 401; authenticated behavior still
  requires a user session. No app settings or shared database objects were changed.

---

## 1. Project Overview

**Goal:** Publicar el piloto de ControlHorario usando la base Azure SQL ya preparada y una
Web App nueva dentro del App Service Plan B1 existente, sin crear otro plan ni otro servicio
facturable. El frontend se servirá inicialmente desde la misma aplicación para la prueba y
quedará preparado para migrarlo a Vercel.

**Path:** Modernize Existing

La aplicación ya tiene cambios locales sin commitear orientados a este objetivo. Se preservarán y se auditarán antes de agregar infraestructura.

---

## 2. Requirements

| Attribute | Proposed value |
|-----------|----------------|
| Classification | POC funcional / herramienta interna de RRHH |
| Scale | Small |
| Budget | Cost-Optimized; reutiliza la base existente durante el piloto |
| Subscription | `Azure subscription 1` (`0e1550d7-88d5-41ca-b980-9f70b31836b1`), donde está la base compartida; se confirma al aprobar este plan |
| Location | West US 3, ubicación del App Service Plan existente aprobado por el usuario |
| Data | DNI, legajos, ausencias y certificados médicos |
| Compliance | Datos internos sensibles; aislamiento, mínimo privilegio y auditoría obligatorios |

---

## 3. Components Detected

| Component | Type | Technology | Path |
|-----------|------|------------|------|
| frontend | SPA | React 19, Vite 7, TypeScript | `src/ui` |
| api | API Service | Node 22+, Fastify 5, TypeScript | `src/api` |
| database | Existing relational database | Azure SQL Database / SQL Server | externo; nuevo esquema `controlhorario` |
| attachments | Sensitive file storage | filesystem adapter | `src/api/repositorioAdjuntos.ts` |
| migrations | Database schema | Azure SQL T-SQL migrations | `db/migrations` |

### Existing deployment support

| Item | Status |
|------|--------|
| Vercel SPA configuration | Present: `vercel.json` |
| API container | Present: root `Dockerfile` |
| Shared-database isolation | Implementado con esquema y rol dedicados de Azure SQL |
| Cross-origin browser session | Present in local changes: exact-origin CORS, credentialed fetch, secure SameSite cookie |
| Azure deployment guide | Present: `docs/despliegue.md` |
| Azure IaC / `azure.yaml` | Se agregará Bicep sólo para la nueva Web App; el plan B1 será `existing` |
| Persistent attachment decision | `/home/controlhorario/adjuntos`, una instancia, piloto |
| Live Azure verification | Base de datos completa; falta Web App |

---

## 4. Recipe Selection

**Selected for this phase:** Bicep + Azure CLI ZIP deploy con build remoto de Oryx.

**Rationale:** Bicep hará reproducible únicamente la Web App y referenciará como existentes
el grupo y el plan B1. No administrará ni recreará el plan, Azure SQL, Centraliza o FSTrack.
El ZIP deploy remoto compilará dependencias nativas para Linux y ejecutará `build` y
`build:azure`.

---

## 5. Architecture

**Stack for the pilot:** Vercel + API + existing Azure SQL, matching the proven Centraliza split.

```text
Browser
  -> Vercel (static React/Vite SPA)
  -> API Fastify
       -> existing Azure SQL over TLS, contained user/role limited to schema controlhorario
       -> persistent attachment storage
```

### Proposed service mapping

| Component | Service | Proposed profile |
|-----------|---------|------------------|
| frontend | Misma Web App durante el smoke; Vercel después | bundle React estático |
| api | Nueva Web App `controlhorario-fisterra` | Node 24 LTS en el plan B1 existente |
| database | Existing Azure SQL Database | no new server/database; dedicated schema and least-privilege principal |
| attachments | App Service persistent `/home/controlhorario/adjuntos` | una instancia durante el piloto |
| secrets and identity | App settings de la nueva Web App | usuario SQL propio y limitado |

### Important constraints

- The browser never receives database credentials and never connects directly to Azure SQL.
- All project tables and the migration ledger live in SQL Server schema `[controlhorario]`, never in `[dbo]`.
- There are no foreign keys, views, triggers or queries involving Centraliza/FSTrack objects.
- Production uses TLS to Azure SQL and a small bounded connection pool.
- Vercel and Azure are different sites; cookies require `SameSite=None; Secure`, exact-origin CORS, and `credentials: include`.
- The API remains at one instance until attachment storage and the in-memory login limiter are made multi-instance-safe.
- Preview deployments in Vercel must not point to the production API.

---

## 6. Provisioning Limit Checklist

Esta fase crea una Web App dentro de un plan ya provisionado. No crea un plan, base,
almacenamiento, Application Insights ni Key Vault. La aplicación comparte los recursos del
B1 existente.

| Resource Type | Number to deploy | Total after deployment | Limit/Quota | Notes |
|---------------|------------------|------------------------|-------------|-------|
| Web Apps en `ASP-fisterrasrlgroup-9f1d` | 1 | 2 | guía B1: hasta 8 | comparte CPU/memoria; sin otro plan |
| App Service Plans | 0 | sin cambios | N/A | no se crea capacidad facturable |
| Storage accounts | 0 | sin cambios | N/A | persistencia incluida del plan para el piloto |

**Status:** No resource quota impact.

### Database objects for the functional pilot

Every object is under `[controlhorario]` and referenced with its fully qualified name.

| Object | Purpose |
|--------|---------|
| `schema_migrations` | version and checksum ledger |
| `empleados` | people imported from QUICKPASS |
| `cargas` | uploaded-file provenance |
| `fichadas` | immutable/raw attendance evidence as validated JSON text |
| `motivos` | controlled absence reasons |
| `ausencias` | RRHH decisions per employee/day |
| `adjuntos` | protected attachment metadata; bytes remain outside SQL |
| `exclusiones` | people excluded from disciplinary notifications |
| `auditoria` | attribution of access and changes |
| `usuarios` | ControlHorario-only accounts |
| `sesiones` | hashed web sessions |
| `configuracion` | global analysis parameters |
| `sector_reglas` | expected punches per sector |
| `exclusiones_semilla` | one-time import ledger for exclusions |

The future manager-attestation objects (`departamentos`, `encargados`, `solicitudes`, `respuestas`, `discrepancias`) are intentionally excluded until that feature is implemented.

---

## 7. Execution Checklist

### Phase 1: Planning

- [x] Analyze workspace
- [x] Record POC classification, small scale, cost profile, and existing-database location
- [x] Scan codebase
- [x] Select database migration/application-port recipe
- [x] Draft architecture
- [x] Confirm from the Centraliza source that the shared engine is Azure SQL (`mssql`), not PostgreSQL
- [x] Confirm no ARM resources or quotas are involved in this phase
- [x] Finalize the database object inventory
- [x] User approved this plan on 2026-09-16

### Phase 2: Execution

- [x] Replace PostgreSQL-specific dependencies/configuration with the `mssql` driver
- [x] Convert the two migrations and ledger runner to idempotent T-SQL
- [x] Port repositories, transactions, parameters, JSON operations and identity returns to Azure SQL
- [x] Add isolation tests that reject non-`controlhorario` object access
- [x] Run typecheck, 261 tests and production build
- [x] Connect read-only and verify engine/database/current schemas without printing credentials
- [x] Apply bootstrap/migrations to Azure SQL only after a preflight confirms `[controlhorario]` does not exist
- [x] Verify the resulting tables, constraints, permissions and absence of cross-project dependencies
- [x] Run a functional smoke test and remove all synthetic rows
- [x] Remove the temporary single-IP firewall rule
- [x] Validate the database-only phase

### Phase 3: Validation

- [x] Validate the database-only phase (no Bicep/Terraform or ARM resources in scope)
- [ ] Invoke a new App Service infrastructure validation when that later phase is prepared

### Phase 4: Deployment

- [x] User approved the existing-plan/no-new-fixed-cost architecture on 2026-09-17
- [x] Generate Bicep for only the new Web App
- [x] Adapt build/startup and persistent attachment path for App Service
- [x] Validate Bicep, what-if, application build and security settings
- [x] Create the isolated SQL runtime user without exposing its password
- [x] Deploy the Web App infrastructure in the existing B1 plan
- [ ] Confirm the application package build completed after the deployment client timed out
- [ ] Verify `/health`, database connectivity and same-origin SPA
- [x] Confirm the Web App is attached to the existing B1 plan

---

## 8. Validation Proof

- `npm.cmd run typecheck`: passed.
- `npm.cmd test`: 261 tests passed.
- `npm.cmd run build`: passed.
- `npm.cmd run build:api`: passed.
- `git diff --check`: passed.
- Azure CLI authentication and subscription context: verified.
- Read-only preflight: Azure SQL database `fstrack`; schema name was free; administrative
  permission was sufficient.
- `npm.cmd run db:verify`: both T-SQL migrations passed against Azure SQL and rolled back.
- `npm.cmd run db:migrate`: both migrations applied; a second run made no changes.
- `npm.cmd run db:inspect`: 14 expected tables, 2 ledger entries, 0 external foreign keys,
  0 external SQL dependencies, and only SELECT/INSERT/UPDATE/DELETE on `[controlhorario]`.
- `npm.cmd run db:smoke`: synthetic upload, history read, absence derivation and manual
  classification passed; cleanup completed.
- `npm.cmd run typecheck`: passed.
- `npm.cmd test`: 261 tests passed.
- `npm.cmd run build`: passed.
- `npm.cmd run build:api`: passed.
- `docker compose config --quiet`: passed.
- Vitest upgraded to 4.1.11; `npm.cmd audit`: 0 vulnerabilities in production or development.
- Docker image build was not executed because the local Docker daemon is not running;
  Compose syntax was validated and the application build itself passed.
- Temporary firewall rule `ControlHorarioPreflight-20260917`: removed and absence verified.

### App Service Validation Proof — 2026-09-17

- `controlhorario-fisterra` global name availability: confirmed.
- Existing target: subscription `0e1550d7-88d5-41ca-b980-9f70b31836b1`, resource group
  `fisterrasrl_group`, plan `ASP-fisterrasrlgroup-9f1d`, region `westus3`.
- `npm.cmd run typecheck`: passed.
- `npm.cmd test`: 261 tests passed with Vitest 4.1.11.
- `npm.cmd run build` and `npm.cmd run build:azure`: passed.
- `az bicep build --file infra/main.bicep`: passed.
- `az deployment group validate`: `Succeeded`.
- `az deployment group what-if`: exactly one Web App and its two publishing-policy child
  resources to create; existing plan, SQL and all other resources ignored.
- Revalidation after adding `VITE_API_BASE_URL=/api`: succeeded; only the new Web App and
  its two publishing-policy children are updated.
- Static role review: no managed identity or Azure RBAC is introduced. Runtime SQL access is
  provisioned through the existing schema-only `[controlhorario_app]` database role.
- Web App infrastructure deployment: succeeded and returned the existing
  `ASP-fisterrasrlgroup-9f1d` plan resource ID.
- Runtime user `controlhorario_runtime`: created as a contained user, added only to
  `[controlhorario_app]`, and verified with zero readable external tables.
- Application ZIP deployment reached the remote Oryx `npm install` phase; the local Azure
  CLI request ended with HTTP 504 before Kudu reported a final result, so live endpoint
  verification remains pending.

### Role Assignment Verification

- Database role `[controlhorario_app]`: verified with schema-only DML grants.
- No Azure RBAC/IaC assignments exist in this database-only phase.
- The future API identity/user must be added to `[controlhorario_app]` during the App Service
  phase; administrative migration credentials must not be used at runtime.

---

## 9. Files to Generate

| File | Purpose | Status |
|------|---------|--------|
| `.azure/deployment-plan.md` | Source of truth for preparation | App Service phase approved |
| `infra/main.bicep` | New Web App referencing the existing B1 plan | Complete |
| `infra/main.parameters.json` | Non-secret deployment parameters | Complete |
| `db/bootstrap/000_esquema_y_rol.sql` | isolated Azure SQL schema/principal grants | Complete |
| `db/migrations/001_initial.sql` | functional data model in T-SQL | Complete |
| `db/migrations/002_acceso_y_decisiones.sql` | accounts/configuration model in T-SQL | Complete |
| `src/api/*` persistence files | Azure SQL-compatible repositories | Complete |

---

## 10. Next Steps

1. Confirm the remote Oryx build result and complete live endpoint verification.
2. Create the first application administrator through the secure interactive command.
3. Deploy the frontend to Vercel and set the exact Vercel origin on the API.
