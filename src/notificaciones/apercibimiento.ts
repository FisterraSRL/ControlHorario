/**
 * The apercibimiento itself: one notification page for one person.
 *
 * Legacy: the letter constants and `buildPersonaXml` (legacy/app.html ~lines 1866-1869 and
 * 2012-2043).
 *
 * Structure, which is fixed: place and date, the recipient block, the heading, the two
 * standard paragraphs, then one numbered highlighted section per falta the person actually
 * incurred, then the shared closing and signature block.
 *
 * The surrounding letter text does NOT vary with which falta triggered it — "estándar
 * indistinto del evento", as the legacy comment puts it. Only the section titles, colours
 * and tints differ. Every Spanish string below is what Fisterra sends to employees today
 * and is reproduced character for character; none of it is this module's to reword.
 */

import { pickDensity, sp } from './densidad.js';
import { wBreak, wHeading, wPara, wRun } from './ooxml.js';
import { buildTablaDeFaltas, META_FALTAS, seccionesDeFaltas, totalDeFaltas } from './tablaDeFaltas.js';
import { fechaLarga } from './fechas.js';
import type { NotificacionPersona, OpcionesNotificacion } from './tipos.js';

/** The city the notification is issued from. */
export const CIUDAD = 'Neuquén';

/** Follows the date. The legacy's `.-` close, kept. */
export const CIERRE_FECHA = '.-';

export const PREFIJO_DESTINATARIO = 'Sr./Sra. ';
export const PREFIJO_CUIL = 'CUIL: ';
export const PREFIJO_SECTOR = 'Sector: ';

export const TITULO_NOTIFICACION = 'Apercibimiento';

export const INTRO_NOTIFICACION =
  'En uso de la facultad de imponer medidas disciplinarias, se le notifica a usted que se ha tomado la decisión de sancionarlo expresamente con un apercibimiento formal, debido a los hechos que a continuación se detallan.';

export const CUERPO_NOTIFICACION =
  'Los motivos de la presente sanción se fundan en los registros de asistencia verificados por el sistema de control horario por huella dactilar de la empresa, conforme se detalla en el/los cuadro/s que se exponen a continuación.';

export const TEXTO_CIERRE =
  'Le recordamos que es obligación del trabajador prestar servicios con puntualidad, diligencia y buena fe, cumpliendo debidamente el régimen de asistencia y horarios establecido por la empresa, así como registrar la totalidad de sus movimientos mediante el sistema de control horario (arts. 62, 63, 84 y 85 de la Ley de Contrato de Trabajo). En virtud de lo expuesto, se lo apercibe expresamente por los hechos detallados en la presente. Se le hace saber que la reiteración de cualquiera de estas conductas dará lugar a la aplicación de sanciones disciplinarias más severas, pudiendo llegar a la suspensión sin goce de haberes.';

export const DESPEDIDA = 'Sin otro particular, lo saludo atentamente.';

/** 36 underscores, as in the legacy. */
export const LINEA_FIRMA = '____________________________________';

export const PIE_FIRMA = 'Firma del Empleado';

/**
 * The blank CUIL line the employee fills in by hand when signing. Yes, the CUIL already
 * appears filled in at the top of the same page — that is how the document in production
 * reads, and it is left alone.
 */
export const PIE_CUIL = 'CUIL:';

/**
 * Builds the body XML of one person's notification page.
 *
 * Returns the empty string when the person has no faltas at all, which is the legacy's
 * signal for "there is nothing to notify" and is what stops an empty page being produced.
 *
 * The density is picked from this person's own total fault count and threaded through
 * every builder, so someone with a couple of faltas gets a comfortably laid out letter and
 * someone with two weeks of them gets the same letter, tighter but still legible — never a
 * second page.
 */
export function buildPersonaXml(
  persona: NotificacionPersona,
  opts: OpcionesNotificacion = {},
): string {
  const secciones = seccionesDeFaltas(persona.faltasPorTipo);
  if (!secciones.length) return '';

  const densidad = pickDensity(totalDeFaltas(persona.faltasPorTipo));
  const hoy = opts.hoy ?? new Date();

  let xml = '';

  xml += wPara(wRun(`${CIUDAD}, ${fechaLarga(hoy)}${CIERRE_FECHA}`, densidad), {
    after: sp(160, densidad),
  });

  xml += wPara(
    wRun(PREFIJO_DESTINATARIO + persona.usuario, densidad) +
      wBreak() +
      wRun(PREFIJO_CUIL + persona.dni, densidad) +
      wBreak() +
      wRun(PREFIJO_SECTOR + persona.sector, densidad),
    { after: sp(160, densidad) },
  );

  xml += wHeading(TITULO_NOTIFICACION, densidad, {
    before: sp(60, densidad),
    after: sp(100, densidad),
  });
  xml += wPara(wRun(INTRO_NOTIFICACION, densidad), { after: sp(110, densidad) });
  xml += wPara(wRun(CUERPO_NOTIFICACION, densidad), { after: sp(140, densidad) });

  secciones.forEach((seccion, idx) => {
    const meta = META_FALTAS[seccion.tipo];
    xml += wPara(
      wRun(`${idx + 1}. ${meta.label}`, densidad, {
        bold: true,
        color: meta.color,
        sz: densidad.sub,
      }),
      // The first section sits tight against the paragraph above it; the rest get air.
      { before: idx ? sp(110, densidad) : 0, after: sp(60, densidad) },
    );
    xml += buildTablaDeFaltas(seccion, densidad);
  });

  xml += wPara(wRun(TEXTO_CIERRE, densidad), {
    before: sp(140, densidad),
    after: sp(140, densidad),
  });
  xml += wPara(wRun(DESPEDIDA, densidad), { after: sp(260, densidad) });
  xml += wPara(wRun(LINEA_FIRMA, densidad));
  xml += wPara(wRun(PIE_FIRMA, densidad));
  xml += wPara(wRun(PIE_CUIL, densidad));

  return xml;
}
