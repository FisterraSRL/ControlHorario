import { describe, expect, it } from 'vitest';

import {
  CUERPO_NOTIFICACION,
  DESPEDIDA,
  INTRO_NOTIFICACION,
  LINEA_FIRMA,
  PIE_CUIL,
  PIE_FIRMA,
  TEXTO_CIERRE,
  TITULO_NOTIFICACION,
  buildPersonaXml,
} from './apercibimiento.js';
import { DENSIDAD_APRETADA, DENSIDAD_COMODA, DENSIDAD_MEDIA, DENSIDAD_MINIMA } from './densidad.js';
import { META_FALTAS } from './tablaDeFaltas.js';
import type { NotificacionPersona } from './tipos.js';
import {
  DESCANSOS,
  HOY_FIJO,
  INCOMPLETAS,
  PERSONA_INYECCION,
  PERSONA_MIXTA,
  PERSONA_SIN_FALTAS,
  TARDANZAS,
  personaDensa,
} from './__fixtures__/personas.js';
import { contar, parsearFragmento, textosDe } from './__fixtures__/xml.js';

const opts = { hoy: HOY_FIJO };

describe('buildPersonaXml: when there is nothing to notify', () => {
  it('produces no page at all, rather than an empty one', () => {
    expect(buildPersonaXml(PERSONA_SIN_FALTAS, opts)).toBe('');
  });
});

describe('buildPersonaXml: the letter', () => {
  const xml = buildPersonaXml(PERSONA_MIXTA, opts);
  const textos = textosDe(xml);

  it('is well-formed WordprocessingML', () => {
    expect(() => parsearFragmento(xml)).not.toThrow();
  });

  it('opens with the place and the long date', () => {
    expect(textos[0]).toBe('Neuquén, 14 de septiembre de 2026.-');
  });

  it('addresses the recipient by name, CUIL and sector, on three lines of one paragraph', () => {
    expect(textos.slice(1, 4)).toEqual([
      'Sr./Sra. Fulano De Tal',
      'CUIL: 20-00000000-1',
      'Sector: Reparto',
    ]);
    // Three runs joined by two soft breaks, all inside a single paragraph: from the name
    // to the end of the paragraph that holds it there is no second `<w:p>`.
    const desdeNombre = xml.slice(xml.indexOf('Sr./Sra.'));
    const bloque = desdeNombre.slice(0, desdeNombre.indexOf('</w:p>'));
    expect(contar(bloque, '<w:br/>')).toBe(2);
    expect(contar(bloque, '<w:p>')).toBe(0);
    expect(bloque).toContain('CUIL: 20-00000000-1');
    expect(bloque).toContain('Sector: Reparto');
  });

  it('carries the heading and the two standard paragraphs, verbatim', () => {
    expect(textos[4]).toBe(TITULO_NOTIFICACION);
    expect(textos[4]).toBe('Apercibimiento');
    expect(textos[5]).toBe(INTRO_NOTIFICACION);
    expect(textos[6]).toBe(CUERPO_NOTIFICACION);
  });

  it('closes with the legal text, the sign-off and the signature block, in that order', () => {
    expect(textos.slice(-5)).toEqual([TEXTO_CIERRE, DESPEDIDA, LINEA_FIRMA, PIE_FIRMA, PIE_CUIL]);
  });

  it('keeps the letter text the same whichever falta triggered it', () => {
    // "estándar indistinto del evento": only the sections in the middle differ.
    const soloTardanza = buildPersonaXml(
      { ...PERSONA_MIXTA, faltasPorTipo: { incompleta: [], descanso: [], tardanza: TARDANZAS } },
      opts,
    );
    for (const texto of [INTRO_NOTIFICACION, CUERPO_NOTIFICACION, TEXTO_CIERRE, DESPEDIDA]) {
      expect(textosDe(soloTardanza)).toContain(texto);
    }
  });
});

describe('buildPersonaXml: the fault sections', () => {
  it('numbers one section per falta incurred, in ORDEN_FALTAS order', () => {
    const textos = textosDe(buildPersonaXml(PERSONA_MIXTA, opts));
    expect(textos).toContain('1. Fichadas incompletas');
    expect(textos).toContain('2. Exceso de descanso');
    expect(textos).toContain('3. Llegadas tarde');
    expect(textos.indexOf('1. Fichadas incompletas')).toBeLessThan(
      textos.indexOf('2. Exceso de descanso'),
    );
    expect(textos.indexOf('2. Exceso de descanso')).toBeLessThan(textos.indexOf('3. Llegadas tarde'));
  });

  it('numbers from one and skips the faltas the person did not incur', () => {
    const soloDescanso: NotificacionPersona = {
      ...PERSONA_MIXTA,
      faltasPorTipo: { incompleta: [], descanso: DESCANSOS, tardanza: TARDANZAS },
    };
    const textos = textosDe(buildPersonaXml(soloDescanso, opts));
    expect(textos).toContain('1. Exceso de descanso');
    expect(textos).toContain('2. Llegadas tarde');
    expect(textos.join('\n')).not.toContain('Fichadas incompletas');
  });

  it('renders a single section for a person with a single falta', () => {
    const uno: NotificacionPersona = {
      ...PERSONA_MIXTA,
      faltasPorTipo: { incompleta: [], descanso: [], tardanza: TARDANZAS },
    };
    const xml = buildPersonaXml(uno, opts);
    expect(contar(xml, '<w:tbl>')).toBe(1);
    expect(textosDe(xml)).toContain('1. Llegadas tarde');
    expect(textosDe(xml)).toContain('0:23');
  });

  it('renders one table per section, with all the rows', () => {
    const xml = buildPersonaXml(PERSONA_MIXTA, opts);
    expect(contar(xml, '<w:tbl>')).toBe(3);
    // Three header rows plus 2 + 1 + 1 data rows.
    expect(contar(xml, '<w:tr>')).toBe(3 + 4);
  });

  it('titles each section in its own colour', () => {
    const xml = buildPersonaXml(PERSONA_MIXTA, opts);
    for (const meta of Object.values(META_FALTAS)) {
      expect(xml).toContain(`<w:color w:val="${meta.color}"/>`);
    }
  });

  it('pins the first section to the paragraph above it and gives the rest air', () => {
    const xml = buildPersonaXml(PERSONA_MIXTA, opts);
    // Only the first section title carries before="0".
    expect(contar(xml, '<w:spacing w:before="0" ')).toBe(1);
  });
});

describe('buildPersonaXml: staying on one page', () => {
  const tamanoDeCuerpo = (xml: string): number => {
    const m = xml.match(/<w:sz w:val="(\d+)"\/>/);
    return Number(m?.[1]);
  };

  it('gives a person with a handful of faltas the comfortable layout', () => {
    expect(tamanoDeCuerpo(buildPersonaXml(personaDensa(4), opts))).toBe(DENSIDAD_COMODA.body);
    expect(tamanoDeCuerpo(buildPersonaXml(personaDensa(6), opts))).toBe(DENSIDAD_COMODA.body);
  });

  it('tightens the whole letter as the fault count crosses each threshold', () => {
    expect(tamanoDeCuerpo(buildPersonaXml(personaDensa(7), opts))).toBe(DENSIDAD_MEDIA.body);
    expect(tamanoDeCuerpo(buildPersonaXml(personaDensa(15), opts))).toBe(DENSIDAD_APRETADA.body);
    expect(tamanoDeCuerpo(buildPersonaXml(personaDensa(31), opts))).toBe(DENSIDAD_MINIMA.body);
  });

  it('picks the density off the total across every falta, not off one bucket', () => {
    // 2 + 1 + 1 = 4 items, so still comfortable; but seven of one kind is not.
    expect(tamanoDeCuerpo(buildPersonaXml(PERSONA_MIXTA, opts))).toBe(DENSIDAD_COMODA.body);
    const siete: NotificacionPersona = {
      ...PERSONA_MIXTA,
      faltasPorTipo: {
        incompleta: [...INCOMPLETAS, ...INCOMPLETAS, ...INCOMPLETAS],
        descanso: DESCANSOS,
        tardanza: TARDANZAS,
      },
    };
    expect(tamanoDeCuerpo(buildPersonaXml(siete, opts))).toBe(DENSIDAD_MEDIA.body);
  });

  it('shrinks the table padding along with the text', () => {
    expect(buildPersonaXml(personaDensa(31), opts)).toContain('<w:top w:w="4" w:type="dxa"/>');
    expect(buildPersonaXml(personaDensa(4), opts)).toContain('<w:top w:w="50" w:type="dxa"/>');
  });
});

describe('buildPersonaXml: hostile input', () => {
  const xml = buildPersonaXml(PERSONA_INYECCION, opts);

  it('still produces one well-formed page', () => {
    expect(() => parsearFragmento(xml)).not.toThrow();
  });

  it('prints a name full of markup as inert text, character for character', () => {
    const textos = textosDe(xml);
    expect(textos).toContain(`Sr./Sra. ${PERSONA_INYECCION.usuario}`);
    expect(textos).toContain(`CUIL: ${PERSONA_INYECCION.dni}`);
    expect(textos).toContain(`Sector: ${PERSONA_INYECCION.sector}`);
  });

  it('does not let the payload add a paragraph, run or table of its own', () => {
    const limpio = buildPersonaXml(
      { ...PERSONA_INYECCION, usuario: 'Alguien', dni: '1', sector: 'S' },
      opts,
    );
    expect(contar(xml, '<w:p>')).toBe(contar(limpio, '<w:p>'));
    expect(contar(xml, '<w:tbl>')).toBe(contar(limpio, '<w:tbl>'));
    expect(contar(xml, '<w:tc>')).toBe(contar(limpio, '<w:tc>'));
  });
});

describe('buildPersonaXml: the date', () => {
  it('is deterministic when a date is supplied', () => {
    expect(buildPersonaXml(PERSONA_MIXTA, opts)).toBe(buildPersonaXml(PERSONA_MIXTA, opts));
  });

  it('defaults to today when no date is supplied', () => {
    const textos = textosDe(buildPersonaXml(PERSONA_MIXTA));
    const hoy = new Date();
    expect(textos[0]).toContain(`de ${hoy.getUTCFullYear()}`);
    expect(textos[0]).toMatch(/^Neuquén, \d{1,2} de \w+ de \d{4}\.-$/u);
  });
});
