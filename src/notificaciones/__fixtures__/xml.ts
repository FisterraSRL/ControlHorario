/**
 * XML helpers the tests share.
 *
 * The point of parsing rather than string-matching is that "Word refuses to open it" is
 * the failure mode that actually costs somebody their afternoon, and a real parser is the
 * only thing that catches it. `@xmldom/xmldom` is a devDependency only — nothing under
 * `src/notificaciones` imports it.
 */

import { DOMParser, onWarningStopParsing } from '@xmldom/xmldom';

/**
 * xmldom's own `Document`, which is not the DOM lib's `Document` the root tsconfig pulls
 * in. Named through the parser's return type so the two never get confused.
 */
export type DocumentoXml = ReturnType<DOMParser['parseFromString']>;

/**
 * Parses a document, throwing on anything the parser is unhappy about — warnings included,
 * which is the strictest setting the parser offers.
 */
export function parsearXml(xml: string): DocumentoXml {
  return new DOMParser({ onError: onWarningStopParsing }).parseFromString(xml, 'text/xml');
}

/**
 * Parses a bare WordprocessingML fragment by wrapping it in a namespaced root. Fragments
 * the builders return are not documents; this makes one out of them without touching the
 * fragment itself. A string that is already a whole document is parsed as it stands.
 */
export function parsearFragmento(fragmentoXml: string): DocumentoXml {
  const esDocumentoCompleto =
    fragmentoXml.startsWith('<?xml') || fragmentoXml.startsWith('<w:document');
  if (esDocumentoCompleto) return parsearXml(fragmentoXml);
  return parsearXml(
    '<w:root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      fragmentoXml +
      '</w:root>',
  );
}

/** Every `<w:t>` text value in a fragment, in document order. */
export function textosDe(fragmentoXml: string): string[] {
  const doc = parsearFragmento(fragmentoXml);
  const nodos = doc.getElementsByTagName('w:t');
  const salida: string[] = [];
  for (let i = 0; i < nodos.length; i++) salida.push(nodos[i]?.textContent ?? '');
  return salida;
}

/** Counts non-overlapping occurrences of a literal needle. */
export function contar(haystack: string, needle: string): number {
  if (!needle) throw new Error('needle must not be empty');
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}
