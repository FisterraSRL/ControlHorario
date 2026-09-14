/**
 * The WordprocessingML fragments every notification is made of: escaped text, runs,
 * paragraphs, headings, breaks and tables.
 *
 * Legacy: `xmlEsc`, `wRun`, `wBreak`, `wPara`, `wHeading`, `wPageBreak`, `wTableCell` and
 * `wTable` (legacy/app.html ~lines 1881-1954). The `.docx` is hand-built as a minimal OOXML
 * package rather than through a third-party `docx` library, which is a deliberate legacy
 * decision: the CDN build of that library is what used to fail in production.
 *
 * The one structural change from the legacy is that the density is passed in instead of
 * read off a mutable global. Byte-for-byte, these functions emit what the legacy emitted.
 */

import { sp } from './densidad.js';
import type { Densidad } from './tipos.js';

/**
 * The five characters that must not reach OOXML as themselves.
 *
 * This table and the character class in `xmlEsc` are the same five characters; the `?? c`
 * fallback there is unreachable and exists only so the lookup types out.
 */
const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/**
 * Turns any value into inert XML text.
 *
 * This is the single most load-bearing function in the module: an employee's name goes
 * straight through it into a document that is handed to that employee. A name containing
 * `<`, `&` or a pasted XML fragment must come out as characters, never as markup — both
 * because markup would corrupt the document Word has to open, and because a notification
 * is not a place where one person's data can rewrite another's.
 *
 * `&` is handled by the same single pass as the rest, so an already-escaped entity is
 * escaped again (`&amp;` becomes `&amp;amp;`) and renders as literal text. That is correct
 * for this call site: everything reaching it is plain text, never pre-escaped markup.
 *
 * `null` and `undefined` become the empty string, matching the legacy.
 *
 * Known gap, kept from the legacy and deliberately not fixed here: control characters
 * (U+0000-U+0008, U+000B, U+000C, U+000E-U+001F) are illegal in XML 1.0 and are passed
 * through unchanged. A `Fecha` or `Usuario` cell carrying one would produce a file Word
 * refuses to open. See `ooxml.test.ts`.
 */
export function xmlEsc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Run formatting. `sz` is in half-points; `color` is a bare RRGGBB hex, no `#`. */
export interface OpcionesRun {
  readonly bold?: boolean;
  readonly color?: string;
  /** Defaults to the density's body size. */
  readonly sz?: number;
}

/**
 * One run of text.
 *
 * `xml:space="preserve"` is required: the letter's own text has leading and trailing
 * spaces around the values it splices in, and Word would otherwise collapse them.
 *
 * Note that `color` is interpolated into an attribute without escaping, exactly as the
 * legacy did. Every colour that reaches it is an internal constant from `META_FALTAS`, so
 * there is no untrusted path into it — but it is not a general-purpose attribute writer.
 */
export function wRun(text: unknown, densidad: Densidad, opts: OpcionesRun = {}): string {
  const sz = opts.sz !== undefined ? opts.sz : densidad.body;
  const rPr =
    '<w:rPr>' +
    (opts.bold ? '<w:b/>' : '') +
    (opts.color ? `<w:color w:val="${opts.color}"/>` : '') +
    `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` +
    '</w:rPr>';
  return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
}

/** A soft line break inside a paragraph. */
export function wBreak(): string {
  return '<w:r><w:br/></w:r>';
}

/** A page break, as its own paragraph. */
export function wPageBreak(): string {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

/** Paragraph properties. `before`/`after` are twips; `jc` is a WordprocessingML alignment. */
export interface OpcionesPara {
  readonly before?: number;
  readonly after?: number;
  readonly jc?: string;
}

/**
 * Wraps already-built runs in a paragraph. Emits `<w:pPr>` only when there is something to
 * put in it, and `<w:jc>` before `<w:spacing>` — the order OOXML's schema requires.
 */
export function wPara(innerXml: string, opts: OpcionesPara = {}): string {
  const spacing =
    opts.before !== undefined || opts.after !== undefined
      ? '<w:spacing' +
        (opts.before !== undefined ? ` w:before="${opts.before}"` : '') +
        (opts.after !== undefined ? ` w:after="${opts.after}"` : '') +
        '/>'
      : '';
  const jc = opts.jc ? `<w:jc w:val="${opts.jc}"/>` : '';
  const ppr = spacing || jc ? `<w:pPr>${jc}${spacing}</w:pPr>` : '';
  return `<w:p>${ppr}${innerXml}</w:p>`;
}

/** Heading options. Everything defaults off the density. */
export interface OpcionesHeading {
  readonly sz?: number;
  readonly before?: number;
  readonly after?: number;
}

/**
 * A bold heading paragraph. Unlike `wPara` it always writes its spacing, defaulting to
 * 120 twips scaled by the density on both sides.
 */
export function wHeading(text: unknown, densidad: Densidad, opts: OpcionesHeading = {}): string {
  const sz = opts.sz !== undefined ? opts.sz : densidad.heading;
  const before = opts.before !== undefined ? opts.before : sp(120, densidad);
  const after = opts.after !== undefined ? opts.after : sp(120, densidad);
  return (
    `<w:p><w:pPr><w:spacing w:before="${before}" w:after="${after}"/></w:pPr>` +
    wRun(text, densidad, { bold: true, sz }) +
    '</w:p>'
  );
}

/** Table cell formatting. `shade` is a bare RRGGBB fill. */
export interface OpcionesCelda {
  readonly bold?: boolean;
  readonly color?: string;
  readonly shade?: string;
}

/** One centred table cell, sized off the density's table size. */
export function wTableCell(text: unknown, densidad: Densidad, opts: OpcionesCelda = {}): string {
  const shd = opts.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.shade}"/>` : '';
  const tcPr = `<w:tcPr><w:tcW w:w="0" w:type="auto"/>${shd}</w:tcPr>`;
  const runOpts: OpcionesRun = {
    sz: densidad.table,
    ...(opts.bold ? { bold: true } : {}),
    ...(opts.color ? { color: opts.color } : {}),
  };
  return `<w:tc>${tcPr}${wPara(wRun(text, densidad, runOpts), { jc: 'center' })}</w:tc>`;
}

/** Table options. See `highlightCol`. */
export interface OpcionesTabla {
  /**
   * Zero-based index of the column that carries the offending value. That column is
   * rendered bold, in the falta's colour, on its soft tint — this is how "resaltando la
   * falta" is expressed on the printed page.
   */
  readonly highlightCol?: number;
  readonly color?: string;
  readonly shade?: string;
}

/**
 * Total grid width in twips the legacy hands out across the columns.
 *
 * Note that the page's own text width is 10206 twips (11906 page minus 850 margins each
 * side), so this under-allocates by 1180. It has no visible effect because the table is
 * declared `w:type="auto"` and Word lays it out itself — `<w:gridCol>` is only a hint. The
 * value is kept as-is rather than "corrected", since changing it is a layout change to a
 * document already in production use.
 */
const ANCHO_GRILLA = 9026;

/** Header row fill. */
const SOMBRA_ENCABEZADO = 'E7ECF0';

/** Border colour of every edge, inside and out. */
const COLOR_BORDE = 'D0D7DD';

/**
 * A bordered table with a shaded header row.
 *
 * Row padding shrinks with the density's `cellPadV` so long tables stay compact. Zero body
 * rows renders the header alone, which is what a table with nothing to report looks like.
 */
export function wTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  densidad: Densidad,
  opts: OpcionesTabla = {},
): string {
  const borders = (['top', 'left', 'bottom', 'right', 'insideH', 'insideV'] as const)
    .map((edge) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="${COLOR_BORDE}"/>`)
    .join('');
  const cellMar =
    '<w:tblCellMar>' +
    `<w:top w:w="${densidad.cellPadV}" w:type="dxa"/><w:bottom w:w="${densidad.cellPadV}" w:type="dxa"/>` +
    '<w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>';
  const tblPr = `<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders>${cellMar}</w:tblPr>`;
  const grid =
    '<w:tblGrid>' +
    headers.map(() => `<w:gridCol w:w="${Math.floor(ANCHO_GRILLA / headers.length)}"/>`).join('') +
    '</w:tblGrid>';
  const headRow =
    '<w:tr>' +
    headers.map((h) => wTableCell(h, densidad, { bold: true, shade: SOMBRA_ENCABEZADO })).join('') +
    '</w:tr>';
  const bodyRows = rows
    .map(
      (r) =>
        '<w:tr>' +
        r
          .map((c, idx) => {
            if (opts.highlightCol !== undefined && idx === opts.highlightCol) {
              return wTableCell(c, densidad, {
                bold: true,
                ...(opts.color !== undefined ? { color: opts.color } : {}),
                ...(opts.shade !== undefined ? { shade: opts.shade } : {}),
              });
            }
            return wTableCell(c, densidad);
          })
          .join('') +
        '</w:tr>',
    )
    .join('');
  return `<w:tbl>${tblPr}${grid}${headRow}${bodyRows}</w:tbl>`;
}
