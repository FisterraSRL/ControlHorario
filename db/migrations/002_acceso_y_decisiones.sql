-- =============================================================================
-- ControlHorario — 002: who is allowed in, and where the human decisions live
--
-- Two things arrive together in this migration, and they arrive together on
-- purpose:
--
--   1. AUTHENTICATION. Until now the API had none: the tunnel was the whole
--      perimeter, and anyone who reached the public address could read every
--      DNI, every legajo and every absence — including the ones whose motivo is
--      "Enfermedad". This migration adds the operator accounts and the
--      server-side sessions that close that hole.
--
--   2. THE DECISION TABLES the Ausencias and Configuración screens write to.
--      They are what make the data worth stealing, which is why 1 cannot come
--      later.
--
-- Nothing here stores a fault, a día type, or any other derived value. Same rule
-- as 001: evidence is evidence, decisions are decisions, and everything else is
-- computed on read by src/domain/fichadas.
-- =============================================================================

BEGIN;

-- =============================================================================
-- ACCESS — the RRHH operators who use the portal
--
-- SCOPE. These are the people who work inside the app: they upload the
-- spreadsheet, classify absences and edit the configuration. Department managers
-- are NOT here and never will be — they are external, they get a tokenized magic
-- link in slice 3, and README decision 2 explains why giving them accounts would
-- kill the flow.
-- =============================================================================

-- An operator. The password is stored as an argon2id PHC string
-- ($argon2id$v=19$m=...,t=...,p=...$salt$hash) — never a bare digest: a SHA of a
-- password is a password, it just takes a rainbow table instead of a guess.
-- The column is deliberately named `hash_contrasena` and not `contrasena`, so a
-- SELECT that leaks into a log or a screenshot says what it is.
CREATE TABLE usuarios (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  nombre          TEXT NOT NULL,
  hash_contrasena TEXT NOT NULL,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  creado_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Lower-cased at the boundary, enforced here. Email is the login identifier and
  -- "Ana@fisterra" and "ana@fisterra" must not be two accounts: the UNIQUE index
  -- is case-sensitive, so the normalisation has to be a constraint, not a habit.
  CONSTRAINT usuarios_email_normalizado CHECK (email = lower(email) AND email <> ''),
  CONSTRAINT usuarios_email_parece_correo CHECK (position('@' IN email) > 1),
  CONSTRAINT usuarios_nombre_no_vacio CHECK (btrim(nombre) <> ''),
  -- A bare hex/base64 digest is not a password hash. The PHC prefix is what the
  -- verifier expects, and this makes a well-meaning "temporary" plain SHA
  -- impossible to insert rather than merely discouraged.
  CONSTRAINT usuarios_hash_es_phc CHECK (hash_contrasena LIKE '$argon2id$%')
);

-- A live login.
--
-- `id` IS A HASH OF THE COOKIE VALUE, never the cookie value itself — same rule
-- as `solicitudes.token_hash` in 001. Whoever can read this table (a dump, a
-- psql session, a restored backup) must not be able to impersonate an operator
-- by pasting a row into their browser.
--
-- Logout deletes the row, which is what makes invalidation server-side: a stolen
-- cookie stops working the moment its owner logs out, instead of staying valid
-- until it expires the way a self-contained signed token would.
CREATE TABLE sesiones (
  id         TEXT PRIMARY KEY,
  usuario_id BIGINT NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  creada_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_at  TIMESTAMPTZ NOT NULL,
  ultima_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sesiones_expira_despues CHECK (expira_at > creada_at)
);

CREATE INDEX sesiones_usuario_idx ON sesiones (usuario_id);
-- Sweeping expired rows is a range scan over this.
CREATE INDEX sesiones_expira_idx ON sesiones (expira_at);

-- =============================================================================
-- CONFIGURATION — the values the Configuración screen edits
--
-- Until this migration they were a constant in the frontend bundle
-- (src/ui/features/configuracion/configuracion.ts), which meant "change the
-- tolerancia" was a deploy. They are three scalars and a per-sector rule, and
-- both shapes are below.
-- =============================================================================

-- The global parameters, one row each, value as JSONB so a later parameter that
-- is not a number does not need a migration to be stored.
--
-- The keys are exactly the fields of `ConfiguracionFichadas` in
-- src/domain/fichadas/tipos.ts, in snake_case. An unknown key here is ignored by
-- the reader rather than rejected: a rollback to a previous version of the app
-- must not fail to boot because a newer version left a parameter behind.
CREATE TABLE configuracion (
  clave           TEXT PRIMARY KEY,
  valor           JSONB NOT NULL,
  actualizado_por TEXT,
  actualizado_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO configuracion (clave, valor) VALUES
  -- Maximum break in minutes before the day raises a `descanso` fault.
  ('descanso_max_min', '30'::jsonb),
  -- Lateness tolerated, in minutes, before a `tardanza` fault.
  ('tolerancia_min', '0'::jsonb),
  -- Contractual weekly hours. A single global value for everyone, as in the
  -- implementation being replaced.
  ('horas_turno_semanales', '51'::jsonb);

-- How many fichadas a day in this sector is supposed to have.
--
-- A sector with NO row here requires four — that is the engine's default and it
-- must stay the default, because the sector column of the QUICKPASS export is
-- free text and a sector nobody has configured yet must not silently become a
-- two-punch sector.
--
-- The three seeded below are the ones the implementation being replaced shipped
-- as defaults (SECTORES_2_FICHADAS in src/domain/fichadas/motivos.ts). They are
-- department names, not people, so unlike `exclusiones` they are safe in source.
CREATE TABLE sector_reglas (
  sector              TEXT PRIMARY KEY,
  fichadas_requeridas INTEGER NOT NULL,
  actualizado_por     TEXT,
  actualizado_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sector_reglas_valor_conocido CHECK (fichadas_requeridas IN (2, 4)),
  CONSTRAINT sector_reglas_sector_no_vacio CHECK (btrim(sector) <> '')
);

INSERT INTO sector_reglas (sector, fichadas_requeridas) VALUES
  ('Reparto', 2),
  ('Cocina', 2),
  ('Administración', 2);

-- =============================================================================
-- EXCLUSIONS — the "do not silently re-add" ledger
--
-- `exclusiones` itself already exists (001). What it lacks is the property that
-- made `ensureDefaultExclusions` in the legacy file correct: seeding must happen
-- ONCE PER PERSON, so that an operator who removes somebody by hand in
-- Configuración does not find them back on the list after the next restart.
--
-- This table is that memory. It records "the seed has already been applied to
-- this DNI", independently of whether the DNI is currently excluded. It is the
-- exact shape of the legacy `cfg.autoExcludedApplied` array.
--
-- The DNIs themselves are still never in git: they arrive at runtime from the
-- operator's own environment (EXCLUSIONES_INICIALES in .env, which is
-- .gitignored) or from the Configuración screen. See the comment on
-- `exclusiones` in 001 for why this rule exists at all.
-- =============================================================================

CREATE TABLE exclusiones_semilla (
  dni         TEXT PRIMARY KEY,
  aplicada_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Who put a person on the exclusion list. 001 records when, not who; a list that
-- decides who never receives a disciplinary notification has to be attributable.
ALTER TABLE exclusiones ADD COLUMN creado_por TEXT;

-- =============================================================================
-- ATTACHMENTS — the columns a real upload needs
--
-- `adjuntos` exists in 001 with `blob_path`, `nombre`, `bytes` and `subido_at`,
-- written when the plan was Azure Blob Storage. The files now live on the local
-- disk in a Docker volume, and two facts about each one were missing.
--
-- THESE FILES ARE MEDICAL CERTIFICATES. `blob_path` holds a generated name and
-- never the operator's filename: the original name is `nombre`, it is data, and
-- it never touches a path. A route that concatenated it would be one `..` away
-- from reading the rest of the disk.
-- =============================================================================

-- The declared content type, validated against an allow-list on upload. Stored
-- so the download route does not have to guess, and so a later audit can tell
-- what kind of file was filed without opening it.
ALTER TABLE adjuntos ADD COLUMN tipo_mime TEXT;

-- Who filed it. Same reasoning as `exclusiones.creado_por`.
ALTER TABLE adjuntos ADD COLUMN subido_por TEXT;

COMMIT;
