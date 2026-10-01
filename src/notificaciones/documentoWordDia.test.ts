import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildPersonaXml } from './apercibimiento.js';
import {
  PARTE_DOCUMENTO,
  buildDocumentXml,
  generarWord,
  generarWordDia,
  nombreArchivoDia,
} from './documentoWord.js';
import { HOY_FIJO, PERSONA_MIXTA, PERSONA_SIN_FALTAS } from './__fixtures__/personas.js';
import type { NotificacionPersona } from './tipos.js';

const opts = { hoy: HOY_FIJO };

function documento(bytes: Uint8Array): string {
  const parte = unzipSync(bytes)[PARTE_DOCUMENTO];
  if (!parte) throw new Error('missing document part');
  return strFromU8(parte);
}

/** PERSONA_MIXTA reduced to its 05/08 row only — what the UI hands over for one day. */
const UN_DIA: NotificacionPersona = {
  ...PERSONA_MIXTA,
  faltasPorTipo: { incompleta: [], descanso: PERSONA_MIXTA.faltasPorTipo.descanso, tardanza: [] },
};

describe('nombreArchivoDia', () => {
  it('appends the day to the per-person name, with the slashes turned into dashes', () => {
    expect(nombreArchivoDia('Fulano De Tal', '14/09/2026')).toBe(
      'Notificacion_Fulano_De_Tal_14-09-2026.docx',
    );
  });

  it('collapses whitespace in the name exactly as nombreArchivoPersona does', () => {
    expect(nombreArchivoDia('Fulano   De\tTal', '01/08/2026')).toBe(
      'Notificacion_Fulano_De_Tal_01-08-2026.docx',
    );
  });

  it('never lets a raw QUICKPASS cell put a character Windows refuses into the name', () => {
    expect(nombreArchivoDia('Zutano', ' 14/09/2026 08:00 ')).toBe('Notificacion_Zutano_14-09-2026-08-00.docx');
    expect(nombreArchivoDia('Zutano', 'a\\b*c?"d<e>f|g')).toBe('Notificacion_Zutano_a-b-c-d-e-f-g.docx');
  });

  it('still names the file when the cell is empty', () => {
    expect(nombreArchivoDia('Zutano', '  ')).toBe('Notificacion_Zutano_sin-fecha.docx');
  });
});

describe('generarWordDia', () => {
  it('returns null when there is nothing to notify', () => {
    expect(generarWordDia(PERSONA_SIN_FALTAS, '05/08/2026', opts)).toBeNull();
  });

  it('names the file after the person and the day', () => {
    expect(generarWordDia(UN_DIA, '05/08/2026', opts)?.nombreArchivo).toBe(
      'Notificacion_Fulano_De_Tal_05-08-2026.docx',
    );
  });

  it('carries exactly the letter generarWord builds for the same faltas', () => {
    const dia = generarWordDia(UN_DIA, '05/08/2026', opts);
    const persona = generarWord(UN_DIA, opts);
    if (!dia || !persona) throw new Error('expected both documents');
    expect(documento(dia.bytes)).toBe(documento(persona.bytes));
    expect(documento(dia.bytes)).toBe(buildDocumentXml(buildPersonaXml(UN_DIA, opts)));
  });
});
