import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  DOCX_CONTENT_TYPES,
  DOCX_RELS,
  MIME_DOCX,
  PARTE_CONTENT_TYPES,
  PARTE_DOCUMENTO,
  PARTE_RELS,
  buildDocumentXml,
  buildDocxBytes,
  generarWord,
  generarWordMasivo,
  nombreArchivoMasivo,
  nombreArchivoPersona,
} from './documentoWord.js';
import { buildPersonaXml } from './apercibimiento.js';
import {
  HOY_FIJO,
  PERSONA_INYECCION,
  PERSONA_MIXTA,
  PERSONA_SIN_FALTAS,
  personaDensa,
} from './__fixtures__/personas.js';
import { contar, parsearXml, textosDe } from './__fixtures__/xml.js';

const opts = { hoy: HOY_FIJO };

/** Unzips a produced document into `path -> text`. */
function abrir(bytes: Uint8Array): Record<string, string> {
  const partes = unzipSync(bytes);
  const salida: Record<string, string> = {};
  for (const [ruta, datos] of Object.entries(partes)) salida[ruta] = strFromU8(datos);
  return salida;
}

describe('buildDocumentXml', () => {
  it('declares UTF-8 and the WordprocessingML namespaces', () => {
    const xml = buildDocumentXml('');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
    expect(xml).toContain(
      'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    );
  });

  it('sets up an A4 page with the narrow margins the one-page layout depends on', () => {
    expect(buildDocumentXml('')).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(buildDocumentXml('')).toContain(
      '<w:pgMar w:top="680" w:right="850" w:bottom="680" w:left="850" w:header="708" w:footer="708" w:gutter="0"/>',
    );
  });

  it('puts the body before the section properties, which is what the schema requires', () => {
    const xml = buildDocumentXml('<w:p/>');
    expect(xml.indexOf('<w:p/>')).toBeLessThan(xml.indexOf('<w:sectPr>'));
  });

  it('is well-formed even with an empty body', () => {
    expect(() => parsearXml(buildDocumentXml(''))).not.toThrow();
  });
});

describe('the .docx package', () => {
  const bytes = buildDocxBytes(buildPersonaXml(PERSONA_MIXTA, opts));
  const partes = abrir(bytes);

  it('is a zip', () => {
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe('PK');
  });

  it('contains exactly the three parts a minimal OOXML package needs', () => {
    expect(Object.keys(partes).sort()).toEqual(
      [PARTE_CONTENT_TYPES, PARTE_RELS, PARTE_DOCUMENTO].sort(),
    );
  });

  it('declares the main document part in [Content_Types].xml', () => {
    expect(partes[PARTE_CONTENT_TYPES]).toBe(DOCX_CONTENT_TYPES);
    expect(partes[PARTE_CONTENT_TYPES]).toContain('PartName="/word/document.xml"');
    expect(partes[PARTE_CONTENT_TYPES]).toContain(`ContentType="${MIME_DOCX}.main+xml"`);
  });

  it('points the package relationship at that same part', () => {
    expect(partes[PARTE_RELS]).toBe(DOCX_RELS);
    expect(partes[PARTE_RELS]).toContain('Target="word/document.xml"');
  });

  it('has a well-formed XML body in every single part', () => {
    // This is the test that stands between a green suite and a file Word refuses to open.
    for (const [ruta, texto] of Object.entries(partes)) {
      expect(() => parsearXml(texto), `${ruta} did not parse`).not.toThrow();
    }
  });

  it('round-trips the text of the letter through the zip unchanged', () => {
    const textos = textosDe(partes[PARTE_DOCUMENTO] ?? '');
    expect(textos).toContain('Sr./Sra. Fulano De Tal');
    expect(textos).toContain('Neuquén, 14 de septiembre de 2026.-');
  });

  it('keeps accented Spanish and the em dash intact through UTF-8 encoding and back', () => {
    for (const texto of ['Neuquén', 'sanción', 'obligación', 'Olvidó fichar', '—']) {
      expect(partes[PARTE_DOCUMENTO]).toContain(texto);
    }
  });

  it('stays well-formed when the input is hostile', () => {
    const conInyeccion = abrir(buildDocxBytes(buildPersonaXml(PERSONA_INYECCION, opts)));
    expect(() => parsearXml(conInyeccion[PARTE_DOCUMENTO] ?? '')).not.toThrow();
  });

  it('stays well-formed for the densest letter the layout supports', () => {
    const denso = abrir(buildDocxBytes(buildPersonaXml(personaDensa(120), opts)));
    expect(() => parsearXml(denso[PARTE_DOCUMENTO] ?? '')).not.toThrow();
  });
});

describe('nombreArchivoPersona', () => {
  it('replaces every run of whitespace with a single underscore', () => {
    expect(nombreArchivoPersona('Fulano De Tal')).toBe('Notificacion_Fulano_De_Tal.docx');
    expect(nombreArchivoPersona('Fulano   De\tTal')).toBe('Notificacion_Fulano_De_Tal.docx');
    expect(nombreArchivoPersona('Zutano')).toBe('Notificacion_Zutano.docx');
  });
});

describe('nombreArchivoMasivo', () => {
  it('names the batch by size and UTC date', () => {
    expect(nombreArchivoMasivo(7, HOY_FIJO)).toBe('Notificaciones_7_personas_2026-09-14.docx');
    expect(nombreArchivoMasivo(1, new Date('2026-01-01T00:00:00Z'))).toBe(
      'Notificaciones_1_personas_2026-01-01.docx',
    );
  });
});

describe('generarWord', () => {
  it('returns the bytes and the filename for a person with faltas', () => {
    const doc = generarWord(PERSONA_MIXTA, opts);
    expect(doc).not.toBeNull();
    expect(doc?.nombreArchivo).toBe('Notificacion_Fulano_De_Tal.docx');
    expect(doc?.bytes).toBeInstanceOf(Uint8Array);
  });

  it('returns null for a person with nothing to notify, rather than an empty document', () => {
    expect(generarWord(PERSONA_SIN_FALTAS, opts)).toBeNull();
  });

  it('produces the same document as assembling the parts by hand', () => {
    const doc = generarWord(PERSONA_MIXTA, opts);
    const aMano = abrir(buildDocxBytes(buildPersonaXml(PERSONA_MIXTA, opts)));
    expect(abrir(doc?.bytes ?? new Uint8Array())[PARTE_DOCUMENTO]).toBe(aMano[PARTE_DOCUMENTO]);
  });

  it('produces exactly one page: no page break anywhere in it', () => {
    const doc = generarWord(PERSONA_MIXTA, opts);
    const xml = abrir(doc?.bytes ?? new Uint8Array())[PARTE_DOCUMENTO] ?? '';
    expect(contar(xml, 'w:type="page"')).toBe(0);
  });
});

describe('generarWordMasivo', () => {
  const personas = [PERSONA_MIXTA, PERSONA_INYECCION, personaDensa(9)];

  it('returns one document for everybody, named by count and date', () => {
    const doc = generarWordMasivo(personas, opts);
    expect(doc?.nombreArchivo).toBe('Notificaciones_3_personas_2026-09-14.docx');
  });

  it('separates the people with a page break, and puts none after the last one', () => {
    const doc = generarWordMasivo(personas, opts);
    const xml = abrir(doc?.bytes ?? new Uint8Array())[PARTE_DOCUMENTO] ?? '';
    expect(contar(xml, '<w:br w:type="page"/>')).toBe(personas.length - 1);
  });

  it('keeps the people in the order it was given them', () => {
    const doc = generarWordMasivo(personas, opts);
    const xml = abrir(doc?.bytes ?? new Uint8Array())[PARTE_DOCUMENTO] ?? '';
    const textos = textosDe(xml);
    const posicion = (nombre: string): number => textos.findIndex((t) => t.includes(nombre));
    expect(posicion('Fulano De Tal')).toBeLessThan(posicion('Mengana'));
    expect(posicion('Mengana')).toBeLessThan(posicion('Zutano Ficticio'));
  });

  it('skips the people who have nothing to notify, and does not count them in the name', () => {
    const doc = generarWordMasivo([PERSONA_SIN_FALTAS, PERSONA_MIXTA, PERSONA_SIN_FALTAS], opts);
    expect(doc?.nombreArchivo).toBe('Notificaciones_1_personas_2026-09-14.docx');
    const xml = abrir(doc?.bytes ?? new Uint8Array())[PARTE_DOCUMENTO] ?? '';
    expect(contar(xml, '<w:br w:type="page"/>')).toBe(0);
    expect(textosDe(xml).join('\n')).not.toContain('Nadie');
  });

  it('returns null when nobody in the list has a falta', () => {
    expect(generarWordMasivo([PERSONA_SIN_FALTAS, PERSONA_SIN_FALTAS], opts)).toBeNull();
    expect(generarWordMasivo([], opts)).toBeNull();
  });

  it('dates every letter in the batch with the same day', () => {
    const doc = generarWordMasivo(personas, opts);
    const xml = abrir(doc?.bytes ?? new Uint8Array())[PARTE_DOCUMENTO] ?? '';
    const fechas = textosDe(xml).filter((t) => t.startsWith('Neuquén, '));
    expect(fechas).toHaveLength(3);
    expect(new Set(fechas).size).toBe(1);
  });

  it('produces a package Word can open, with every part well-formed', () => {
    const doc = generarWordMasivo(personas, opts);
    const partes = abrir(doc?.bytes ?? new Uint8Array());
    expect(Object.keys(partes)).toHaveLength(3);
    for (const [ruta, texto] of Object.entries(partes)) {
      expect(() => parsearXml(texto), `${ruta} did not parse`).not.toThrow();
    }
  });

  it('gives each person their own density, not one shared across the batch', () => {
    // A comfortable letter and a tight one in the same file.
    const doc = generarWordMasivo([PERSONA_MIXTA, personaDensa(40)], opts);
    const xml = abrir(doc?.bytes ?? new Uint8Array())[PARTE_DOCUMENTO] ?? '';
    expect(xml).toContain('<w:sz w:val="20"/>');
    expect(xml).toContain('<w:sz w:val="15"/>');
  });
});

describe('purity', () => {
  it('does not touch the DOM, and nothing in the module needs one', () => {
    // The suite runs in vitest's node environment: if any of this reached for `document`
    // or `window`, every test above would already have thrown.
    expect(typeof globalThis.document).toBe('undefined');
    expect(typeof globalThis.window).toBe('undefined');
  });

  it('produces the same bytes for the same input, twice in a row', () => {
    const a = abrir(generarWord(PERSONA_MIXTA, opts)?.bytes ?? new Uint8Array());
    const b = abrir(generarWord(PERSONA_MIXTA, opts)?.bytes ?? new Uint8Array());
    expect(a).toEqual(b);
  });

  it('does not mutate the persona it was given', () => {
    const antes = JSON.stringify(PERSONA_MIXTA);
    generarWord(PERSONA_MIXTA, opts);
    generarWordMasivo([PERSONA_MIXTA], opts);
    expect(JSON.stringify(PERSONA_MIXTA)).toBe(antes);
  });
});
