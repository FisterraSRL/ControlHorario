/**
 * The `.docx` package: a minimal, valid OOXML zip built by hand.
 *
 * Legacy: `buildDocumentXml`, `DOCX_CONTENT_TYPES`, `DOCX_RELS`, `buildDocxBlob`,
 * `generarWord` and `generarWordMasivo` (legacy/app.html ~lines 1955-2088).
 *
 * Two things changed on the way out of the legacy, both at the edges, neither touching the
 * document's content:
 *
 *  - The zip comes from `fflate` rather than JSZip. JSZip pulls four transitive
 *    dependencies (including `readable-stream` 2.x); fflate has none, works unchanged in
 *    the browser and in Node, and offers a synchronous API.
 *  - Nothing downloads. `offerDownload` and `fallbackDownload` are DOM code and belong to
 *    the UI layer; these functions return bytes and the name to save them under, and the
 *    caller decides what to do with them.
 *
 * That also makes the whole path synchronous. The legacy was a Promise only because
 * JSZip's `generateAsync` was; there is no I/O here, the documents are a few kilobytes, and
 * a synchronous function is one less thing for a caller to get wrong.
 */

import { strToU8, zipSync } from 'fflate';

import { buildPersonaXml } from './apercibimiento.js';
import { wPageBreak } from './ooxml.js';
import { totalDeFaltas } from './tablaDeFaltas.js';
import type { DocumentoGenerado, NotificacionPersona, OpcionesNotificacion } from './tipos.js';

/** The media type of a `.docx`, for whoever has to label these bytes. */
export const MIME_DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Wraps a body in a WordprocessingML document.
 *
 * The `sectPr` is A4 (11906 x 16838 twips) with narrow margins, which is what lets a dense
 * letter still fit on one page.
 */
export function buildDocumentXml(bodyXml: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<w:body>${bodyXml}` +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="680" w:right="850" w:bottom="680" w:left="850" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>'
  );
}

/** `[Content_Types].xml` — the part Word reads first to learn what is in the package. */
export const DOCX_CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

/** `_rels/.rels` — points the package at its main document part. */
export const DOCX_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

/** Path of the main document part inside the package. */
export const PARTE_DOCUMENTO = 'word/document.xml';
/** Path of the content-types part. */
export const PARTE_CONTENT_TYPES = '[Content_Types].xml';
/** Path of the package relationships part. */
export const PARTE_RELS = '_rels/.rels';

/**
 * Assembles the three parts into a `.docx` and returns its bytes.
 *
 * See `DocumentoGenerado` for why this is a `Uint8Array` rather than a `Blob`.
 */
export function buildDocxBytes(bodyXml: string): Uint8Array {
  return zipSync({
    [PARTE_CONTENT_TYPES]: strToU8(DOCX_CONTENT_TYPES),
    [PARTE_RELS]: strToU8(DOCX_RELS),
    [PARTE_DOCUMENTO]: strToU8(buildDocumentXml(bodyXml)),
  });
}

/** `Notificacion_Nombre_Apellido.docx`. Whitespace in the name collapses to underscores. */
export function nombreArchivoPersona(usuario: string): string {
  return `Notificacion_${usuario.replace(/\s+/g, '_')}.docx`;
}

/** `Notificaciones_7_personas_2026-09-14.docx`. The date is UTC, like everything else here. */
export function nombreArchivoMasivo(cantidad: number, hoy: Date): string {
  return `Notificaciones_${cantidad}_personas_${hoy.toISOString().slice(0, 10)}.docx`;
}

/**
 * One person's notification as a finished `.docx`.
 *
 * Returns `null` when the person has no faltas — there is nothing to notify, and the
 * legacy resolved `false` in exactly that case.
 */
export function generarWord(
  persona: NotificacionPersona,
  opts: OpcionesNotificacion = {},
): DocumentoGenerado | null {
  const bodyXml = buildPersonaXml(persona, opts);
  if (!bodyXml) return null;
  return {
    nombreArchivo: nombreArchivoPersona(persona.usuario),
    bytes: buildDocxBytes(bodyXml),
  };
}

/**
 * Every person's notification as ONE `.docx`, one page each, page-broken between them and
 * in the order given.
 *
 * A single multi-page file rather than N downloads is a deliberate legacy decision: the
 * browser download capability can only carry one unanswered save prompt at a time and
 * cannot save a `.zip`, so one Word file is how everybody gets their notification in one
 * shot. Callers who want separate files can call `generarWord` per person.
 *
 * Returns `null` when nobody in the list has a falta.
 */
export function generarWordMasivo(
  personas: readonly NotificacionPersona[],
  opts: OpcionesNotificacion = {},
): DocumentoGenerado | null {
  const conFaltas = personas.filter((p) => totalDeFaltas(p.faltasPorTipo) > 0);
  if (!conFaltas.length) return null;

  // One `hoy` for the whole batch: it dates every letter and names the file. The legacy
  // called `new Date()` separately per letter and again for the filename, which could
  // straddle midnight mid-run and date the same batch two different days.
  const hoy = opts.hoy ?? new Date();
  const perLetterOpts: OpcionesNotificacion = { hoy };

  const bodyXml = conFaltas
    .map((persona, i) => {
      const pxml = buildPersonaXml(persona, perLetterOpts);
      return pxml + (pxml && i < conFaltas.length - 1 ? wPageBreak() : '');
    })
    .join('');

  return {
    nombreArchivo: nombreArchivoMasivo(conFaltas.length, hoy),
    bytes: buildDocxBytes(bodyXml),
  };
}
