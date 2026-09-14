/**
 * Aggregates day records into the weekly Horas Trabajadas report, one row per
 * (dni, semana). Pure: it only reads the records handed to it.
 */

import { MOTIVOS_POR_DEFECTO, indiceMotivosTrabajados } from './motivos.js';
import type { ConfiguracionFichadas, RegistroDia, SemanaEmpleado } from './tipos.js';

/** Contractual weekly hours when nothing else is configured. */
const HORAS_TURNO_SEMANALES_POR_DEFECTO = 51;

interface Acumulador {
  dni: string;
  inicioSemana: string;
  usuario: string;
  legajo: string;
  /** Insertion-ordered so that a tie in frequency keeps the first sector seen. */
  conteoSectores: Map<string, number>;
  horasTrabajadas: number;
  horasDescanso: number;
  horasJustificadas: number;
  diasAusenciaSinClasificar: number;
  dias: RegistroDia[];
}

export function reporteSemanal(
  registros: readonly RegistroDia[],
  cfg: ConfiguracionFichadas = {},
): SemanaEmpleado[] {
  const motivoTrabajado = indiceMotivosTrabajados(cfg.motivos ?? MOTIVOS_POR_DEFECTO);

  const grupos = new Map<string, Acumulador>();
  for (const r of registros) {
    // A row with no parseable date or no DNI cannot be attributed to anyone's week.
    if (!r.inicioSemana || !r.dni) continue;
    const clave = r.dni + '|' + r.inicioSemana;
    let g = grupos.get(clave);
    if (!g) {
      g = {
        dni: r.dni,
        inicioSemana: r.inicioSemana,
        usuario: r.usuario,
        legajo: r.legajo,
        conteoSectores: new Map(),
        horasTrabajadas: 0,
        horasDescanso: 0,
        horasJustificadas: 0,
        diasAusenciaSinClasificar: 0,
        dias: [],
      };
      grupos.set(clave, g);
    }
    g.conteoSectores.set(r.sector, (g.conteoSectores.get(r.sector) ?? 0) + 1);
    g.dias.push(r);

    if (r.tipoDia === 'trabajo') {
      g.horasTrabajadas += r.horasBrutas;
      g.horasDescanso += r.descansoReal || 0;
    } else if (r.tipoDia === 'ausencia') {
      // An absence with a `worked` motivo still pays the contractual shift; an absence with
      // no motivo at all is the pending queue — "sin clasificar" is the ABSENCE of a motivo,
      // never a stored status.
      if (r.motivoId && motivoTrabajado.get(r.motivoId)) g.horasJustificadas += r.horasTurno;
      else if (!r.motivoId) g.diasAusenciaSinClasificar++;
    }
  }

  // A single global contractual figure applied to everyone, not a per-person contract.
  const horasTurnoFijas = (cfg.horasTurnoSemanales || HORAS_TURNO_SEMANALES_POR_DEFECTO) * 60;

  const salida: SemanaEmpleado[] = [];
  for (const g of grupos.values()) {
    let sector = '';
    let mejor = -1;
    for (const [s, n] of g.conteoSectores) {
      if (n > mejor) {
        mejor = n;
        sector = s;
      }
    }
    salida.push({
      dni: g.dni,
      usuario: g.usuario,
      legajo: g.legajo,
      sector,
      inicioSemana: g.inicioSemana,
      horasTurno: horasTurnoFijas,
      horasTrabajadas: g.horasTrabajadas,
      horasDescanso: g.horasDescanso,
      horasJustificadas: g.horasJustificadas,
      diferencia: g.horasTrabajadas + g.horasJustificadas - horasTurnoFijas,
      diasAusenciaSinClasificar: g.diasAusenciaSinClasificar,
      dias: g.dias,
    });
  }

  salida.sort(
    (a, b) =>
      a.sector.localeCompare(b.sector) ||
      a.usuario.localeCompare(b.usuario) ||
      a.inicioSemana.localeCompare(b.inicioSemana),
  );
  return salida;
}
