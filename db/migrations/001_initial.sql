-- =============================================================================
-- ControlHorario — initial schema
-- PostgreSQL 14+ (Azure Database for PostgreSQL Flexible Server)
--
-- The model has three layers, and the boundary between them is the whole point:
--
--   1. EVIDENCE      What QUICKPASS said. Append-only, never edited by a human.
--   2. DECISIONS     What a person decided about that evidence, and who they are.
--   3. ATTESTATION   What a department manager signed off on, frozen at send time.
--
-- Two things are deliberately absent from this schema:
--
--   * There is no `faltas` / `irregularidades` table. Faults (fichada incompleta,
--     descanso excedido, tardanza) are DERIVED from the evidence by the rules engine
--     in src/domain/fichadas on every read. That is exactly what lets a rule fix
--     retroactively correct the entire history: change the rule, the past re-derives.
--     A stored fault would freeze a bug into the record forever.
--
--   * There is no `estado` column on ausencias. "Sin clasificar" is the ABSENCE of a
--     motivo (motivo_id IS NULL), never a stored status. See the VIEW section.
-- =============================================================================

BEGIN;

-- =============================================================================
-- ENUMS
-- =============================================================================

-- Who decided the motivo of an absence.
--   'partes'    QUICKPASS's own novedad note, classified automatically by the engine.
--   'manual'    RRHH, inside the app.
--   'encargado' A department manager, through a tokenized magic link.
-- Precedence when 'manual' and 'encargado' disagree over the same (dni, fecha):
-- RRHH wins — but the manager's answer is NOT discarded. See `discrepancias`.
CREATE TYPE motivo_source AS ENUM ('partes', 'manual', 'encargado');

-- Lifecycle of an attestation request.
CREATE TYPE solicitud_estado AS ENUM ('borrador', 'enviada', 'respondida', 'vencida', 'anulada');

-- =============================================================================
-- LAYER 1 — IMMUTABLE EVIDENCE
-- Nothing in this layer is ever updated in place. It is what the company can show.
-- =============================================================================

-- The people QUICKPASS knows about. DNI is the only stable identifier the export
-- carries; the name is a display label and is spelled inconsistently between exports
-- (accents come and go), so never join on it.
CREATE TABLE empleados (
  dni     TEXT PRIMARY KEY,
  nombre  TEXT NOT NULL,
  legajo  TEXT,
  sector  TEXT,
  activo  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX empleados_sector_idx ON empleados (sector) WHERE activo;

-- Audit of every uploaded QUICKPASS export. One row per file, so any fichada can be
-- traced back to the spreadsheet it came from and the person who uploaded it.
CREATE TABLE cargas (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  archivo    TEXT NOT NULL,
  subido_por TEXT NOT NULL,
  subido_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  filas      INTEGER NOT NULL DEFAULT 0
);

-- THE PERMANENT EVIDENTIARY RECORD.
--
-- `payload` is the original QUICKPASS row verbatim — every column, unparsed, including
-- the ones this app does not read today. The engine parses it on the way out; nothing
-- ever writes an interpreted value back into it. A day stays queryable and its faults
-- stay backed by the original row long after the Excel that produced it is gone.
--
-- A re-upload of the same (dni, fecha) overwrites the payload and re-points carga_id:
-- the latest export is the correction, and `cargas` + `auditoria` keep the trail.
CREATE TABLE fichadas (
  dni       TEXT NOT NULL,
  fecha     DATE NOT NULL,
  payload   JSONB NOT NULL,
  carga_id  BIGINT NOT NULL REFERENCES cargas (id) ON DELETE RESTRICT,
  PRIMARY KEY (dni, fecha)
);

CREATE INDEX fichadas_fecha_idx ON fichadas (fecha);
CREATE INDEX fichadas_carga_idx ON fichadas (carga_id);
-- The engine groups by ISO week; the sector lives inside the payload.
CREATE INDEX fichadas_sector_idx ON fichadas ((payload ->> 'Sector'));

-- =============================================================================
-- LAYER 2 — HUMAN DECISIONS
-- =============================================================================

-- The closed list of motivos de ausencia. `worked` decides whether an absent day still
-- counts as hours worked in the Horas Trabajadas report. Rows are never deleted —
-- `activo` retires one without orphaning the history that references it.
CREATE TABLE motivos (
  id      INTEGER PRIMARY KEY,
  label   TEXT NOT NULL UNIQUE,
  worked  BOOLEAN NOT NULL,
  activo  BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO motivos (id, label, worked) VALUES
  (1, 'Ausente sin Aviso',  FALSE),
  (2, 'Ausente con Aviso',  FALSE),
  (3, 'Suspensión',         FALSE),
  (4, 'Enfermedad',         TRUE),
  (5, 'Feriado',            TRUE),
  (6, 'Autorizado empresa', TRUE),
  (7, 'Vacaciones',         TRUE),
  -- Dual: a motivo de ausencia AND, on its own, grounds for a Fichadas Incompletas
  -- notification — the person was on shift but never registered it. It counts as
  -- worked; the fault it raises is derived by the engine, not stored here.
  (8, 'Olvidó fichar',      TRUE),
  -- Does NOT count as worked: the hours are being paid back, not performed.
  (9, 'Recupera Horas',     FALSE);

-- A human's decision over one day. A row exists only once someone (or the engine's
-- reading of the QUICKPASS note) has something to say about that day.
--
-- motivo_id IS NULL is legitimate and meaningful: the day was opened — an attachment
-- was filed, a request went out — but no motivo has been chosen yet. That is what
-- "sin clasificar" means. It is NOT a status value.
CREATE TABLE ausencias (
  dni           TEXT NOT NULL,
  fecha         DATE NOT NULL,
  motivo_id     INTEGER REFERENCES motivos (id) ON DELETE RESTRICT,
  motivo_source motivo_source,
  resuelto_por  TEXT,
  resuelto_at   TIMESTAMPTZ,
  PRIMARY KEY (dni, fecha),
  FOREIGN KEY (dni, fecha) REFERENCES fichadas (dni, fecha) ON DELETE CASCADE,
  -- A motivo always has an origin, and an origin without a motivo is meaningless.
  CONSTRAINT ausencias_motivo_con_origen CHECK (
    (motivo_id IS NULL AND motivo_source IS NULL) OR
    (motivo_id IS NOT NULL AND motivo_source IS NOT NULL)
  ),
  -- Anything a human resolved is attributable.
  CONSTRAINT ausencias_resuelto_atribuible CHECK (
    motivo_source <> 'manual' OR (resuelto_por IS NOT NULL AND resuelto_at IS NOT NULL)
  )
);

CREATE INDEX ausencias_pendientes_idx ON ausencias (fecha) WHERE motivo_id IS NULL;
CREATE INDEX ausencias_motivo_idx ON ausencias (motivo_id);

-- PRECEDENCE. RRHH ('manual') outranks a department manager ('encargado'). A manager's
-- answer may never silently overwrite what RRHH already decided — but it is not thrown
-- away either: the caller records it in `discrepancias` and leaves the RRHH row alone.
CREATE FUNCTION ausencias_rrhh_gana() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.motivo_source = 'manual'
     AND NEW.motivo_source = 'encargado'
     AND NEW.motivo_id IS DISTINCT FROM OLD.motivo_id
  THEN
    RAISE EXCEPTION
      'RRHH ya resolvió (%, %) con motivo %; la respuesta del encargado se conserva en discrepancias, no pisa esta fila.',
      OLD.dni, OLD.fecha, OLD.motivo_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ausencias_rrhh_gana_trg
  BEFORE UPDATE ON ausencias
  FOR EACH ROW EXECUTE FUNCTION ausencias_rrhh_gana();

-- Supporting paperwork for a day: a medical certificate, a leave form. The file lives
-- in Blob Storage; only its path and metadata live here.
CREATE TABLE adjuntos (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dni        TEXT NOT NULL,
  fecha      DATE NOT NULL,
  blob_path  TEXT NOT NULL UNIQUE,
  nombre     TEXT NOT NULL,
  bytes      BIGINT NOT NULL CHECK (bytes >= 0),
  subido_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (dni, fecha) REFERENCES fichadas (dni, fecha) ON DELETE CASCADE
);

CREATE INDEX adjuntos_dia_idx ON adjuntos (dni, fecha);

-- People excluded from disciplinary notifications. Their hours still count in the Horas
-- Trabajadas report; they simply never appear in a notification.
--
-- THIS TABLE EXISTS BECAUSE THE NAMES DO NOT BELONG IN SOURCE CODE. The implementation
-- being replaced (legacy/app.html) hardcoded six real employee names in a
-- DEFAULT_EXCLUDED_NAMES array — personal data, in a public repository, in git history
-- forever. The operator seeds this table at runtime. Never seed it from a migration,
-- a fixture, a test, or a comment.
CREATE TABLE exclusiones (
  dni          TEXT PRIMARY KEY,
  motivo_texto TEXT,
  creado_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- LAYER 3 — ATTESTATION FLOW
--
-- Department managers are EXTERNAL to the app. They are never users, they have no
-- account and no password. They receive a tokenized magic link, answer once, and leave.
-- Their "signature" is choosing a motivo per employee from the full closed list.
-- =============================================================================

CREATE TABLE departamentos (
  id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE
);

-- Maps the free-text `Sector` column of the QUICKPASS export to the department a
-- manager actually owns.
--
-- NOT YET CONFIRMED: whether `Sector` maps 1:1 to the departments managers own. Until
-- someone confirms it with the company, the default is IDENTITY — one departamento per
-- distinct sector, same name — and this table is what makes a later regrouping (several
-- sectors under one departamento, or a sector split) a data change instead of a
-- migration. Do not denormalise departamento_id onto fichadas.
CREATE TABLE sector_departamento (
  sector          TEXT PRIMARY KEY,
  departamento_id INTEGER NOT NULL REFERENCES departamentos (id) ON DELETE RESTRICT
);

CREATE TABLE encargados (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  departamento_id INTEGER NOT NULL REFERENCES departamentos (id) ON DELETE RESTRICT,
  nombre          TEXT NOT NULL,
  email           TEXT NOT NULL,
  UNIQUE (departamento_id, email)
);

-- One attestation request sent to one manager for one period.
--
-- `snapshot` is a FROZEN copy of exactly the irregularities that were put in front of
-- that manager: the employees, the days, the faults, the evidence, as of the moment the
-- email was sent. It is NEVER a live query. If a later upload changes the underlying
-- fichadas, the manager still sees — and is still bound by — what they were actually
-- shown. `snapshot_hash` is the digest of that payload, and the signature binds to the
-- hash: a snapshot that no longer hashes to `snapshot_hash` is not the thing that was
-- signed, and the answer must be treated as void.
--
-- `token_hash` is a hash of the magic-link token, never the token itself: whoever reads
-- this table must not be able to impersonate a manager.
CREATE TABLE solicitudes (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  encargado_id   INTEGER NOT NULL REFERENCES encargados (id) ON DELETE RESTRICT,
  periodo_desde  DATE NOT NULL,
  periodo_hasta  DATE NOT NULL,
  snapshot       JSONB NOT NULL,
  snapshot_hash  TEXT NOT NULL,
  token_hash     TEXT NOT NULL UNIQUE,
  enviada_at     TIMESTAMPTZ,
  vence_at       TIMESTAMPTZ,
  respondida_at  TIMESTAMPTZ,
  estado         solicitud_estado NOT NULL DEFAULT 'borrador',
  CONSTRAINT solicitudes_periodo_ordenado CHECK (periodo_hasta >= periodo_desde),
  CONSTRAINT solicitudes_enviada_tiene_fecha CHECK (
    estado = 'borrador' OR enviada_at IS NOT NULL
  )
);

CREATE INDEX solicitudes_encargado_idx ON solicitudes (encargado_id, periodo_desde);
CREATE INDEX solicitudes_abiertas_idx ON solicitudes (vence_at) WHERE estado = 'enviada';

-- What the manager answered, one row per employee-day they were asked about. The
-- (dni, fecha) pair is NOT a foreign key to fichadas on purpose: the answer is about
-- the frozen snapshot, and it must survive the evidence being re-uploaded or corrected.
CREATE TABLE respuestas (
  solicitud_id  BIGINT NOT NULL REFERENCES solicitudes (id) ON DELETE CASCADE,
  dni           TEXT NOT NULL,
  fecha         DATE NOT NULL,
  motivo_id     INTEGER NOT NULL REFERENCES motivos (id) ON DELETE RESTRICT,
  comentario    TEXT,
  respondida_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (solicitud_id, dni, fecha)
);

-- The manager and RRHH disagreed about the same day. RRHH's decision stands in
-- `ausencias`; the manager's is preserved here, in full, with both sides visible, so
-- the disagreement is a fact someone can review rather than an overwrite nobody sees.
CREATE TABLE discrepancias (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dni               TEXT NOT NULL,
  fecha             DATE NOT NULL,
  motivo_rrhh       INTEGER REFERENCES motivos (id) ON DELETE RESTRICT,
  motivo_encargado  INTEGER REFERENCES motivos (id) ON DELETE RESTRICT,
  solicitud_id      BIGINT REFERENCES solicitudes (id) ON DELETE SET NULL,
  detectada_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revisada_at       TIMESTAMPTZ,
  CONSTRAINT discrepancias_hay_desacuerdo CHECK (motivo_rrhh IS DISTINCT FROM motivo_encargado),
  -- One open discrepancy per day and request; answering again updates it.
  UNIQUE (dni, fecha, solicitud_id)
);

CREATE INDEX discrepancias_abiertas_idx ON discrepancias (detectada_at) WHERE revisada_at IS NULL;

-- =============================================================================
-- AUDIT
-- =============================================================================

-- Append-only. Every state change an actor caused, with the payload that caused it.
CREATE TABLE auditoria (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor      TEXT NOT NULL,
  accion     TEXT NOT NULL,
  entidad    TEXT NOT NULL,
  entidad_id TEXT,
  datos      JSONB,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX auditoria_entidad_idx ON auditoria (entidad, entidad_id, at DESC);
CREATE INDEX auditoria_at_idx ON auditoria (at DESC);

-- =============================================================================
-- DERIVED STATE — VIEWS, NOT COLUMNS
--
-- READ THIS BEFORE ADDING AN `estado` COLUMN ANYWHERE ABOVE.
--
-- "Sin clasificar" is not a state a row is put into. It is the observable consequence
-- of one fact: no motivo has been decided. Storing it as a column would create two
-- sources of truth for that single fact — a motivo_id, and a status string that has to
-- be kept in agreement with it by every write path, forever. They drift. The first time
-- a motivo is assigned by a path that forgets to update the status, the pending queue
-- lies, and the only way to find out is that somebody was notified for a day that was
-- already resolved.
--
-- The same reasoning is why there is no `faltas` table: a fault is the consequence of
-- the evidence plus the current rules, so it is derived on read by the engine.
-- =============================================================================

-- The pending queue: days a human has opened but not yet decided.
CREATE VIEW ausencias_pendientes AS
  SELECT
    a.dni,
    a.fecha,
    e.nombre           AS empleado,
    f.payload ->> 'Sector' AS sector,
    a.resuelto_por,
    a.resuelto_at
  FROM ausencias a
  JOIN fichadas f ON f.dni = a.dni AND f.fecha = a.fecha
  LEFT JOIN empleados e ON e.dni = a.dni
  WHERE a.motivo_id IS NULL;

-- The superset the engine works from: every day of evidence with no motivo on record —
-- whether or not an `ausencias` row exists for it at all. SQL deliberately does NOT
-- decide which of these days are actually absences: that is a rule, the rules live in
-- src/domain/fichadas, and re-implementing them here would be the same two-sources-of-
-- truth mistake in a different shape.
CREATE VIEW dias_sin_motivo AS
  SELECT
    f.dni,
    f.fecha,
    f.payload,
    f.carga_id,
    (a.dni IS NOT NULL) AS tiene_fila_ausencia
  FROM fichadas f
  LEFT JOIN ausencias a ON a.dni = f.dni AND a.fecha = f.fecha
  WHERE a.motivo_id IS NULL;

COMMIT;
