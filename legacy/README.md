# legacy/

`app.html` is the implementation this project replaces. It is **reference material, not
live code.** Nothing in `src/` imports it, nothing builds it, and it is not deployed.

## What it is

A single 2131-line file — inline CSS, markup and an ES5 IIFE — originally built as a Claude
Artifact. It reads a QUICKPASS Excel export in the browser, derives attendance
irregularities, keeps a shared absence registry through the artifact storage capability, and
generates Word notifications. It has been in real use, and it works.

## Why it is kept

It is the only written specification of the rules. Lines 410–654 are the engine, and the
port in `src/domain/fichadas` is derived from them line by line. Several behaviours there
look like accidents and are not:

- `"F: 0hs"` is a franco, not a flexible shift.
- The order of `PARTES_MAP` decides whether a note that says both "Recupera Horas" and
  "Autorizado" pays hours or not.
- Motivo 8, "Olvidó fichar", is the one motivo that is simultaneously an absence and a
  compliance fault.
- An excluded person still accrues hours; they only stop generating notifications.

When the ported engine and this file disagree, **this file is the question, not the
answer** — check it against the business before changing either.

## What must not be copied out of it

`DEFAULT_EXCLUDED_NAMES` (around line 429) hardcodes six real employees by name. That list
is personal data and it does not belong in source. In the new system it lives in the
`exclusiones` table, seeded by the operator at runtime. Do not copy those names into any
new file, test, fixture, comment or commit message.

## Editing

Don't. If a rule turns out to be wrong, fix it in `src/domain/fichadas`, with a test that
states the rule, and leave this file as the historical record of what the system used to do.
