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
npm test          # run the suite once
npm run test:watch
npm run typecheck
```

Slice 1 has no Azure dependency, no database connection and no server. `npm test` runs the
whole of it.

## The three slices

**Slice 1 — foundation (this one).** Repo scaffolding, the SQL schema, the rules engine
extracted from the legacy file into pure, typed, tested functions, and the design-token
layer. No cloud, no network, no I/O. The point is to get the rules out of a 2131-line HTML
file and under test *before* anything depends on them.

**Slice 2 — the app.** Upload pipeline into Postgres (`cargas` + `fichadas`), the RRHH
screens over the derived irregularities, the absence registry with attachments in Blob
Storage, and the Word notifications. Static Web Apps + Functions in front of the schema in
`db/migrations`.

**Slice 3 — the attestation flow.** Tokenized magic links to department managers, the
frozen snapshot, the answers coming back, discrepancy detection, the reminder timer, and
the audit trail that makes the whole thing hold up.

## Layout

```
db/migrations/001_initial.sql   the schema, heavily commented — read it before slice 2
src/domain/fichadas/            the rules engine: pure, no DOM, no I/O, no dependencies
src/ui/tokens/                  brand tokens (vendored, unedited) + the application layer
legacy/app.html                 the implementation being replaced. Reference only.
```

`src/domain` is organised by what the code is about, not by what it technically is. There
is no `models/`, `services/` or `utils/`: a folder called `utils` tells you nothing about
the business, and the business is the hard part here. Files are named for the concept —
`dia.ts`, `semana.ts`, `motivos.ts`, `parseo.ts`.

Domain identifiers are in **Spanish** and stay that way. `fichada`, `ausencia`, `motivo`,
`legajo`, `turno`, `parte`, `descanso`, `tardanza` are the words the business uses and the
words QUICKPASS prints; translating them would invent a second vocabulary that nobody
speaks and every conversation would need a glossary. Comments are in English.

## Decisions

**1. The cloud is Azure.** Postgres Flexible Server, Static Web Apps + Functions, Blob
Storage for attachments, a Functions timer trigger for reminders, Communication Services
for email. Chosen over Supabase for procurement reasons, not technical ones — the technical
case was close.

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

Real payroll data never enters this repository. `.gitignore` excludes `*.xlsx` / `*.csv`;
the QUICKPASS export carries DNI, legajo and full names.

The list of people excluded from disciplinary notifications lives in the `exclusiones`
table, seeded by the operator at runtime — never in source, a migration, a fixture or a
test. The legacy file hardcodes six real names; that is the specific mistake this table
exists to undo, and it is why the remote for this repository is not safe to push to until
the privacy review of the legacy file is finished.
