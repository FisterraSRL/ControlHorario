import {
  claveIrregularidad, type ClaveIrregularidad,
  type DecisionIrregularidad, type RevisionIrregularidad,
} from '../../../domain/cierre.js';
import { fmtFechaAR, type RegistroDia } from '../../../domain/fichadas/index.js';
import type { RangoPeriodo } from '../../periodo/periodo.js';
import { lineaFichadas } from '../horas/horas.js';

export function mesLiquidacionValido(mes: string): boolean {
  return /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(mes);
}

export function rangoDeLiquidacion(mesLiquidacion: string, corte: number): RangoPeriodo {
  const anio = Number(mesLiquidacion.slice(0, 4));
  const mes = Number(mesLiquidacion.slice(5, 7)) - 1;
  const ultimoDiaAnterior = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const ultimoDiaActual = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return {
    desde: new Date(Date.UTC(anio, mes - 1, Math.min(corte, ultimoDiaAnterior) + 1)),
    hasta: new Date(Date.UTC(anio, mes, Math.min(corte, ultimoDiaActual))),
  };
}

export interface FilaIrregularidad extends ClaveIrregularidad {
  readonly usuario: string;
  readonly sector: string;
  readonly fechaVisible: string;
  readonly detalle: string;
  readonly fichadas: string | null;
  readonly decision: DecisionIrregularidad | null;
}

export function construirIrregularidades(
  dias: readonly RegistroDia[],
  revisiones: readonly RevisionIrregularidad[],
): readonly FilaIrregularidad[] {
  const porClave = new Map(revisiones.map((r) => [claveIrregularidad(r), r]));
  return dias.flatMap((dia) => {
    if (!dia.fecha || !dia.dni) return [];
    const fecha = dia.fecha.toISOString().slice(0, 10);
    return dia.faltas.map((falta) => {
      const clave = { dni: dia.dni, fecha, tipo: falta.tipo };
      return {
        ...clave,
        usuario: dia.usuario,
        sector: dia.sector,
        fechaVisible: fmtFechaAR(dia.fecha),
        detalle: falta.detalle,
        fichadas: lineaFichadas(dia),
        decision: porClave.get(claveIrregularidad(clave)) ?? null,
      };
    });
  }).sort((a, b) => a.sector.localeCompare(b.sector, 'es') ||
    a.usuario.localeCompare(b.usuario, 'es') || a.fecha.localeCompare(b.fecha));
}

export function ultimaFechaCargada(dias: readonly RegistroDia[]): Date | null {
  return dias.reduce<Date | null>((ultima, { fecha }) => fecha && (!ultima || fecha > ultima) ? fecha : ultima, null);
}
