import { describe, expect, it } from 'vitest';

import { DENSIDAD_COMODA, DENSIDAD_MINIMA, sp } from './densidad.js';
import {
  wBreak,
  wHeading,
  wPageBreak,
  wPara,
  wRun,
  wTable,
  wTableCell,
  xmlEsc,
} from './ooxml.js';
import { contar, parsearFragmento, textosDe } from './__fixtures__/xml.js';

describe('xmlEsc', () => {
  it('escapes every one of the five characters that break OOXML', () => {
    expect(xmlEsc('&')).toBe('&amp;');
    expect(xmlEsc('<')).toBe('&lt;');
    expect(xmlEsc('>')).toBe('&gt;');
    expect(xmlEsc('"')).toBe('&quot;');
    expect(xmlEsc("'")).toBe('&apos;');
  });

  it('escapes all of them together without eating one another', () => {
    expect(xmlEsc(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });

  it('escapes the ampersand of an entity it produces, so nothing is double-decoded', () => {
    // A single pass over the source means `&` is never re-examined after substitution.
    expect(xmlEsc('a & b')).toBe('a &amp; b');
    expect(xmlEsc('&lt;')).toBe('&amp;lt;');
    expect(xmlEsc('&amp;')).toBe('&amp;amp;');
  });

  it('treats null and undefined as the empty string', () => {
    expect(xmlEsc(null)).toBe('');
    expect(xmlEsc(undefined)).toBe('');
    expect(xmlEsc('')).toBe('');
  });

  it('stringifies whatever it is given, because table cells are not always strings', () => {
    expect(xmlEsc(0)).toBe('0');
    expect(xmlEsc(42)).toBe('42');
    expect(xmlEsc(false)).toBe('false');
    expect(xmlEsc(NaN)).toBe('NaN');
  });

  it('leaves accents, the em dash and other non-ASCII text alone', () => {
    expect(xmlEsc('Neuquén — Administración')).toBe('Neuquén — Administración');
  });

  it('does not escape control characters — a known legacy gap, documented not fixed', () => {
    // U+0000-U+0008, U+000B, U+000C and U+000E-U+001F are illegal in XML 1.0 and would
    // make Word refuse the file. The legacy passes them through and so does this; the
    // assertion exists so the gap is visible rather than assumed away.
    expect(xmlEsc('a\u0000b')).toBe('a\u0000b');
    expect(xmlEsc('a\u000Bb')).toBe('a\u000Bb');
    // Tab, newline and carriage return, by contrast, are legal XML and safely pass.
    expect(xmlEsc('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });
});

describe('xmlEsc as the injection boundary', () => {
  // An employee's name goes straight into a document that is handed to that employee.
  // These are the cases that must never become markup.
  const nombresHostiles: readonly string[] = [
    'Mengana <w:t>INYECTADA</w:t>',
    'Fulano & Zutano',
    'Fulana "Comillas" De Tal',
    "Zutano O'Brien",
    '</w:t></w:r></w:p><w:p><w:r><w:t>Pagina falsa',
    '<?xml version="1.0"?><w:document/>',
    '<![CDATA[raw]]>',
    '&#60;script&#62;',
    '<!-- comentario -->',
    ']]>&<',
  ];

  it.each(nombresHostiles)('renders %j as inert text inside the run', (nombre) => {
    const xml = wRun(nombre, DENSIDAD_COMODA);

    // The fragment still parses, which it would not if the payload had closed a tag.
    expect(() => parsearFragmento(xml)).not.toThrow();

    // Exactly one text node, and it reads back as the original string, character for
    // character. That is the real assertion: nothing was lost and nothing became markup.
    expect(textosDe(xml)).toEqual([nombre]);

    // The payload's own angle brackets are gone from the serialised form.
    const cuerpo = xml.slice(xml.indexOf('<w:t '), xml.lastIndexOf('</w:t>'));
    expect(cuerpo).not.toContain('<w:t>');
    expect(cuerpo).not.toContain('</w:p>');
    expect(cuerpo).not.toContain('<?xml');
  });

  it('does not let a payload smuggle in a second run or paragraph', () => {
    const xml = wRun('</w:t></w:r><w:r><w:t>segundo', DENSIDAD_COMODA);
    expect(contar(xml, '<w:r>')).toBe(1);
    expect(contar(xml, '</w:r>')).toBe(1);
    expect(contar(xml, '<w:t ')).toBe(1);
  });

  it('keeps a hostile name inert all the way through a table cell', () => {
    const nombre = '<w:tc><w:p><w:r><w:t>celda inyectada</w:t></w:r></w:p></w:tc>';
    const xml = wTableCell(nombre, DENSIDAD_COMODA);
    expect(contar(xml, '<w:tc>')).toBe(1);
    expect(textosDe(xml)).toEqual([nombre]);
  });
});

describe('wRun', () => {
  it('takes its size from the density when the caller does not ask for one', () => {
    expect(wRun('hola', DENSIDAD_COMODA)).toBe(
      '<w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>' +
        '<w:t xml:space="preserve">hola</w:t></w:r>',
    );
    expect(wRun('hola', DENSIDAD_MINIMA)).toContain('<w:sz w:val="15"/>');
  });

  it('honours an explicit size over the density, including a size of zero', () => {
    expect(wRun('x', DENSIDAD_COMODA, { sz: 44 })).toContain('<w:sz w:val="44"/><w:szCs w:val="44"/>');
    expect(wRun('x', DENSIDAD_COMODA, { sz: 0 })).toContain('<w:sz w:val="0"/>');
  });

  it('emits bold and colour only when asked, in that order', () => {
    expect(wRun('x', DENSIDAD_COMODA, { bold: true })).toContain('<w:rPr><w:b/><w:sz');
    expect(wRun('x', DENSIDAD_COMODA, { color: 'B93A2A' })).toContain(
      '<w:rPr><w:color w:val="B93A2A"/><w:sz',
    );
    expect(wRun('x', DENSIDAD_COMODA, { bold: true, color: 'A66A10' })).toContain(
      '<w:rPr><w:b/><w:color w:val="A66A10"/><w:sz',
    );
    expect(wRun('x', DENSIDAD_COMODA, { bold: false })).not.toContain('<w:b/>');
  });

  it('always preserves whitespace, because the letter splices values into spaced text', () => {
    const xml = wRun('  dos espacios  ', DENSIDAD_COMODA);
    expect(xml).toContain('xml:space="preserve"');
    expect(textosDe(xml)).toEqual(['  dos espacios  ']);
  });
});

describe('wBreak and wPageBreak', () => {
  it('produce the exact fragments the legacy produced', () => {
    expect(wBreak()).toBe('<w:r><w:br/></w:r>');
    expect(wPageBreak()).toBe('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  });
});

describe('wPara', () => {
  const run = '<w:r/>';

  it('omits pPr entirely when there is nothing to put in it', () => {
    expect(wPara(run)).toBe('<w:p><w:r/></w:p>');
    expect(wPara(run, {})).toBe('<w:p><w:r/></w:p>');
  });

  it('writes only the spacing edge it was given', () => {
    expect(wPara(run, { before: 60 })).toBe(
      '<w:p><w:pPr><w:spacing w:before="60"/></w:pPr><w:r/></w:p>',
    );
    expect(wPara(run, { after: 140 })).toBe(
      '<w:p><w:pPr><w:spacing w:after="140"/></w:pPr><w:r/></w:p>',
    );
    expect(wPara(run, { before: 60, after: 140 })).toBe(
      '<w:p><w:pPr><w:spacing w:before="60" w:after="140"/></w:pPr><w:r/></w:p>',
    );
  });

  it('treats a spacing of zero as a value, not as absent', () => {
    // `before: 0` is how the first fault section is pinned to the paragraph above it.
    expect(wPara(run, { before: 0 })).toBe(
      '<w:p><w:pPr><w:spacing w:before="0"/></w:pPr><w:r/></w:p>',
    );
  });

  it('puts jc before spacing, which is the order the OOXML schema requires', () => {
    expect(wPara(run, { jc: 'center', after: 20 })).toBe(
      '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="20"/></w:pPr><w:r/></w:p>',
    );
  });
});

describe('wHeading', () => {
  it('is bold, heading-sized, and spaced off the density by default', () => {
    const esperado = sp(120, DENSIDAD_COMODA);
    expect(wHeading('Apercibimiento', DENSIDAD_COMODA)).toBe(
      `<w:p><w:pPr><w:spacing w:before="${esperado}" w:after="${esperado}"/></w:pPr>` +
        '<w:r><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr>' +
        '<w:t xml:space="preserve">Apercibimiento</w:t></w:r></w:p>',
    );
  });

  it('lets the caller override size and both spacing edges', () => {
    const xml = wHeading('T', DENSIDAD_COMODA, { sz: 40, before: 1, after: 2 });
    expect(xml).toContain('<w:spacing w:before="1" w:after="2"/>');
    expect(xml).toContain('<w:sz w:val="40"/>');
  });

  it('escapes its text like any other run', () => {
    expect(textosDe(wHeading('A & B', DENSIDAD_COMODA))).toEqual(['A & B']);
  });
});

describe('wTableCell', () => {
  it('centres its text and sizes it off the density table size', () => {
    expect(wTableCell('Fecha', DENSIDAD_COMODA)).toBe(
      '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>' +
        '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
        '<w:r><w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr>' +
        '<w:t xml:space="preserve">Fecha</w:t></w:r></w:p></w:tc>',
    );
  });

  it('adds a shading element only when a fill was given', () => {
    expect(wTableCell('x', DENSIDAD_COMODA, { shade: 'E7ECF0' })).toContain(
      '<w:shd w:val="clear" w:color="auto" w:fill="E7ECF0"/>',
    );
    expect(wTableCell('x', DENSIDAD_COMODA, { shade: '' })).not.toContain('<w:shd');
    expect(wTableCell('x', DENSIDAD_COMODA)).not.toContain('<w:shd');
  });

  it('passes bold and colour down to the run', () => {
    const xml = wTableCell('0:23', DENSIDAD_COMODA, { bold: true, color: 'B93A2A' });
    expect(xml).toContain('<w:b/><w:color w:val="B93A2A"/>');
  });
});

describe('wTable', () => {
  const headers = ['Fecha', 'Horario de Turno', 'Horario Fichado', 'Minutos de Tardanza'];

  it('renders the header row alone when there are no body rows', () => {
    const xml = wTable(headers, [], DENSIDAD_COMODA);
    expect(contar(xml, '<w:tr>')).toBe(1);
    expect(textosDe(xml)).toEqual(headers);
    expect(() => parsearFragmento(xml)).not.toThrow();
  });

  it('renders one body row after the header', () => {
    const xml = wTable(headers, [['07/08/2026', '08:00 - 17:00', '08:23', '0:23']], DENSIDAD_COMODA);
    expect(contar(xml, '<w:tr>')).toBe(2);
    expect(textosDe(xml)).toEqual([...headers, '07/08/2026', '08:00 - 17:00', '08:23', '0:23']);
  });

  it('renders many body rows in the order it was given them', () => {
    const filas = Array.from({ length: 25 }, (_, i) => [`${i}`, 'turno', 'fichado', `${i * 2}`]);
    const xml = wTable(headers, filas, DENSIDAD_COMODA);
    expect(contar(xml, '<w:tr>')).toBe(26);
    expect(contar(xml, '<w:tc>')).toBe(26 * 4);
    const textos = textosDe(xml).slice(headers.length);
    expect(textos.filter((_, i) => i % 4 === 0)).toEqual(filas.map((f) => f[0]));
  });

  it('shades the header row and nothing else, unless a column is highlighted', () => {
    const xml = wTable(headers, [['a', 'b', 'c', 'd']], DENSIDAD_COMODA);
    expect(contar(xml, 'w:fill="E7ECF0"')).toBe(4);
    expect(contar(xml, '<w:shd')).toBe(4);
  });

  it('highlights only the requested column, in the colour and tint it was given', () => {
    const xml = wTable(headers, [['a', 'b', 'c', 'd']], DENSIDAD_COMODA, {
      highlightCol: 3,
      color: 'B93A2A',
      shade: 'FBE1DC',
    });
    expect(contar(xml, 'w:fill="FBE1DC"')).toBe(1);
    expect(contar(xml, '<w:color w:val="B93A2A"/>')).toBe(1);
    // The header row is bold too, so four of the five bold runs are headers.
    expect(contar(xml, '<w:b/>')).toBe(5);
  });

  it('highlights column zero when asked, which a truthiness check would have missed', () => {
    const xml = wTable(headers, [['a', 'b', 'c', 'd']], DENSIDAD_COMODA, {
      highlightCol: 0,
      color: 'A66A10',
      shade: 'FBEBD3',
    });
    const primeraCelda = xml.slice(xml.lastIndexOf('<w:tr>'));
    expect(primeraCelda.indexOf('FBEBD3')).toBeLessThan(primeraCelda.indexOf('</w:tc>'));
  });

  it('divides the grid width across the columns, floored', () => {
    expect(wTable(headers, [], DENSIDAD_COMODA)).toContain('<w:gridCol w:w="2256"/>');
    expect(contar(wTable(headers, [], DENSIDAD_COMODA), '<w:gridCol')).toBe(4);
    expect(wTable(['solo'], [], DENSIDAD_COMODA)).toContain('<w:gridCol w:w="9026"/>');
    expect(wTable(['a', 'b', 'c'], [], DENSIDAD_COMODA)).toContain('<w:gridCol w:w="3008"/>');
  });

  it('takes its cell padding from the density', () => {
    expect(wTable(headers, [], DENSIDAD_COMODA)).toContain('<w:top w:w="50" w:type="dxa"/>');
    expect(wTable(headers, [], DENSIDAD_MINIMA)).toContain('<w:top w:w="4" w:type="dxa"/>');
    // Horizontal padding is fixed; only the vertical padding scales.
    expect(wTable(headers, [], DENSIDAD_MINIMA)).toContain('<w:left w:w="80" w:type="dxa"/>');
  });

  it('borders every edge, inside and out, in one colour', () => {
    const xml = wTable(headers, [], DENSIDAD_COMODA);
    for (const edge of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) {
      expect(xml).toContain(`<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="D0D7DD"/>`);
    }
  });

  it('does not divide by zero when there are no headers at all', () => {
    // Not something the letter asks for, but the legacy never guarded it either: the map
    // simply never runs, so no width is ever computed.
    const xml = wTable([], [], DENSIDAD_COMODA);
    expect(xml).toContain('<w:tblGrid></w:tblGrid>');
    expect(xml).not.toContain('Infinity');
    expect(xml).not.toContain('NaN');
  });

  it('escapes header and cell text', () => {
    const xml = wTable(['A & B'], [['<w:p/>']], DENSIDAD_COMODA);
    expect(textosDe(xml)).toEqual(['A & B', '<w:p/>']);
  });
});
