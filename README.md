# ControlHorario

Control de fichadas for an Argentine company running QUICKPASS time clocks.

RRHH uploads the QUICKPASS Excel export. The system derives the attendance irregularities —
incomplete fichadas, breaks over the limit, tardanzas — asks department managers to account
for them, records what RRHH decides, and produces the disciplinary notifications. Every
number it prints has to be defensible months later, which is why the evidence, the human
decisions and the manager attestations are three separate things that never overwrite each
other.

It replaces a single-file browser tool (`legacy/app.html`) that is still in use. That file
is the specification of the rules; read `legacy/README.md` before touching the engine.

## Running it

```bash
npm install
npm run dev       # the app, on http://localhost:5173 (localStorage, no server needed)
npm run build     # typecheck + production bundle into dist/
npm run build:api # compile the Node API into dist-api/
npm run api       # run the API (needs Postgres; see docs/servidor.md)
npm run db:migrate
npm run preview
npm test          # run the suite once
npm run test:watch
npm run typecheck # both projects: the frontend and the API
```

`npm test` runs the rules engine, which has no database connection and no server. `npm run
dev` with no `.env` runs the whole app on localStorage — no Postgres, no Docker, no
network. That is the offline path and it is meant to keep working.

**The whole server is `docker compose up -d`. Everything about running it — WSL2, autostart,
the tunnel, backups, restores, and what to check when it is down — is in
[`docs/servidor.md`](docs/servidor.md), in Spanish.**

## The three slices

**Slice 1 — foundation (this one).** Repo scaffolding, the SQL schema, the rules engine
extracted from the legacy file into pure, typed, tested functions, and the design-token
layer. No cloud, no network, no I/O. The point is to get the rules out of a 2131-line HTML
file and under test *before* anything depends on them.

**Slice 2 — the app.** Upload pipeline into Postgres (`cargas` + `fichadas`), the RRHH
screens over the derived irregularities, the absence registry with attachments, and the
Word notifications. **2c is done**: the schema runs on a real Postgres, the historial is
persisted through a REST API behind the same port, and the whole thing is self-hosted.

**Slice 3 — the attestation flow.** Tokenized magic links to department managers, the
frozen snapshot, the answers coming back, discrepancy detection, the reminder timer, and
the audit trail that makes the whole thing hold up.

## Layout

```
db/migrations/*.sql             the schema, heavily commented — applied by the runner
src/domain/fichadas/            the rules engine: pure, no DOM, no I/O, no dependencies
src/api/                        the Fastify server: REST, the Postgres adapter, migrations
src/ui/tokens/                  brand tokens (vendored, unedited) + the application layer
src/ui/features/<negocio>/      one folder per screen, named for the business
src/ui/components/              atoms / molecules / organisms — the shared library only
src/ui/historial/               the persistence port and its two adapters
src/ui/periodo/                 the día / semana / mes / año window
src/ui/app/                     routing, shell, sidebar counts
docker-compose.yml              the whole server: postgres, api, tailscale, backup
docker/                         backup, autostart and tunnel scripts mounted by compose
docs/servidor.md                how to run, back up, restore and fix the server (Spanish)
legacy/app.html                 the implementation being replaced. Reference only.
```

The UI is organised the same way the domain is: the top-level folders under `features/`
name the business — `carga`, `ausencias`, `notificaciones` — not the technology. Atomic
design applies only to `components/`, which is the shared library: anything used by exactly
one screen lives in that screen's folder. Containers hold state and talk to the domain and
the repository; presentational components take props and render, and import neither.

`src/domain` is organised by what the code is about, not by what it technically is. There
is no `models/`, `services/` or `utils/`: a folder called `utils` tells you nothing about
the business, and the business is the hard part here. Files are named for the concept —
`dia.ts`, `semana.ts`, `motivos.ts`, `parseo.ts`.

Domain identifiers are in **Spanish** and stay that way. `fichada`, `ausencia`, `motivo`,
`legajo`, `turno`, `parte`, `descanso`, `tardanza` are the words the business uses and the
words QUICKPASS prints; translating them would invent a second vocabulary that nobody
speaks and every conversation would need a glossary. Comments are in English.

## Decisions

**1. There is no cloud. It is self-hosted.** ~~Azure: Postgres Flexible Server, Static Web
Apps + Functions, Blob Storage.~~ Procurement would have blocked the project indefinitely,
so it runs on a Windows 10 Pro machine in the Fisterra office: Docker Engine inside WSL2 —
not Docker Desktop, which does not start until somebody logs in — with Postgres in a named
volume, one Node service, and a Tailscale Funnel for the public HTTPS address. No domain to
buy, no inbound port, no invoice. The operational burden is accepted knowingly and is
documented in `docs/servidor.md`.

**1b. The exposure layer is an adapter, like the persistence layer.** Tailscale Funnel
today; a Cloudflare Tunnel on a Fisterra domain the day one exists (the service is written
and commented in `docker-compose.yml`). The application never learns which one is in front
of it: its public address comes from `APP_URL_PUBLICA`, never from a `Host` header, because
the magic links of slice 3 are built from it and a link built from a header is a link an
attacker can rewrite.

**2. Department managers are external to the app.** They are never users. No accounts, no
passwords, no onboarding. They get a tokenized magic link, answer, and leave. Anything that
would require a manager to *have an account* is out of scope by construction: the people
who have to answer these requests will not maintain a login for something they touch once a
month.

**3. The manager's signature is choosing a motivo.** Not a checkbox, not a free-text reply:
one motivo per employee, from the same closed list RRHH uses. A free-text answer is not
comparable with an RRHH decision, and comparing them is the entire point of slice 3.

**4. The request payload is frozen at send time.** `solicitudes.snapshot` is a copy of
exactly the irregularities put in front of that manager, with `snapshot_hash` beside it. It
is never re-derived from a live query. If a later upload changes the underlying fichadas,
the manager is still answering — and still bound by — what they were actually shown. A
snapshot that no longer matches its hash is not the thing that was signed.

**5. On a collision, RRHH wins and the manager's answer is kept.** When RRHH (`manual`) and
a manager (`encargado`) disagree about the same `(dni, fecha)`, the RRHH decision stands and
the manager's answer is preserved in `discrepancias`, with both motivos side by side. It is
never silently overwritten: a disagreement between HR and a department about someone's
attendance is information, and discarding it is how the record stops being trustworthy. A
trigger on `ausencias` enforces the precedence at the database level.

**6. "Sin clasificar" is derived, never stored.** It means `motivo_id IS NULL` and nothing
else. An `estado` column would create two sources of truth for one fact — the motivo, and a
status string every write path has to keep in agreement with it — and they drift. The first
write path that forgets leaves the pending queue lying, and you find out when someone gets
notified for a day that was already resolved. See the VIEW section of the migration.

**7. Faults are always derived from the evidence, never stored.** `fichada incompleta`,
`descanso excedido` and `tardanza` are computed from the QUICKPASS row plus the current
rules, on every read. That is exactly what makes a rule fix retroactive: correct the rule
and the whole history re-derives correctly. A stored fault freezes the bug into the record
permanently, and the table would have to be recomputed and rewritten — with no way to tell
afterwards which rows were rewritten and which were originally right.

## Privacy

Real payroll data never enters this repository. `.gitignore` excludes `*.xlsx` / `*.csv`
(the QUICKPASS export carries DNI, legajo and full names) and `*.dump` / `respaldos/` (a
database dump is the whole history in one file). `.dockerignore` excludes the same things,
plus `.env` — the build context is copied wholesale into image layers.

The API never logs a row. An upload logs six integers; a database error is reduced to its
SQLSTATE and constraint name before it reaches the log, because Postgres writes the values
of the offending row into the error message — the `ausencias` precedence trigger prints a
DNI and a fecha. See the header of `src/api/errores.ts`.

The list of people excluded from disciplinary notifications lives in the `exclusiones`
table, seeded by the operator at runtime — never in source, a migration, a fixture or a
test. The legacy file hardcodes six real names; that is the specific mistake this table
exists to undo, and it is why the remote for this repository is not safe to push to until
the privacy review of the legacy file is finished.
