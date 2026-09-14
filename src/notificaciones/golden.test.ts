/**
 * Parity with the code that is in production today.
 *
 * `__fixtures__/legacy.golden.json` was produced by executing the ORIGINAL WORD GENERATION
 * section of `legacy/app.html` — lifted out of the file and run as-is, with `Date` shadowed
 * so it is reproducible — over the inputs in `__fixtures__/personas.ts`. It is the actual
 * output of the generator Fisterra uses, not a transcription of what it ought to be.
 *
 * Every assertion here is `toBe`, on the whole document, deliberately: these letters go to
 * real employees and back real disciplinary decisions, so "close enough" is not a category.
 * If one of these fails, the extracted module has changed what a notification says, and
 * that is a decision for a person to make, not a diff to wave through.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildPersonaXml } from './apercibimiento.js';
import { buildDocumentXml } from './documentoWord.js';
import { wPageBreak } from './ooxml.js';
import {
  HOY_FIJO,
  PERSONA_INYECCION,
  PERSONA_MIXTA,
  PERSONA_SIN_FALTAS,
  personaDensa,
} from './__fixtures__/personas.js';

interface Golden {
  readonly mixta: string;
  readonly inyeccion: string;
  readonly densa7: string;
  readonly densa31: string;
  readonly sinFaltas: string;
  readonly masiva: string;
  readonly documentoCompleto: string;
}

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('./__fixtures__/legacy.golden.json', import.meta.url)), 'utf8'),
) as Golden;

const opts = { hoy: HOY_FIJO };

describe('parity with legacy/app.html', () => {
  it('reproduces a letter with all three faltas, byte for byte', () => {
    expect(buildPersonaXml(PERSONA_MIXTA, opts)).toBe(golden.mixta);
  });

  it('reproduces the escaping of a hostile name, byte for byte', () => {
    expect(buildPersonaXml(PERSONA_INYECCION, opts)).toBe(golden.inyeccion);
  });

  it('reproduces the medium density tier, byte for byte', () => {
    expect(buildPersonaXml(personaDensa(7), opts)).toBe(golden.densa7);
  });

  it('reproduces the tightest density tier, byte for byte', () => {
    expect(buildPersonaXml(personaDensa(31), opts)).toBe(golden.densa31);
  });

  it('reproduces the empty result for somebody with no faltas', () => {
    expect(buildPersonaXml(PERSONA_SIN_FALTAS, opts)).toBe(golden.sinFaltas);
    expect(golden.sinFaltas).toBe('');
  });

  it('reproduces the bulk document, page breaks included, byte for byte', () => {
    const conFaltas = [PERSONA_MIXTA, PERSONA_INYECCION];
    const armado = conFaltas
      .map((persona, i) => {
        const pxml = buildPersonaXml(persona, opts);
        return pxml + (pxml && i < conFaltas.length - 1 ? wPageBreak() : '');
      })
      .join('');
    expect(armado).toBe(golden.masiva);
  });

  it('reproduces the whole document.xml, sectPr and all, byte for byte', () => {
    expect(buildDocumentXml(buildPersonaXml(PERSONA_MIXTA, opts))).toBe(golden.documentoCompleto);
  });

  it('has a golden fixture that is actually populated, so a green run means something', () => {
    expect(golden.mixta.length).toBeGreaterThan(10_000);
    expect(golden.documentoCompleto.length).toBeGreaterThan(golden.mixta.length);
  });
});
