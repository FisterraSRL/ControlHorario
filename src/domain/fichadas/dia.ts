/**
 * One person, one day: turns a raw QUICKPASS row into the derived `RegistroDia`.
 *
 * Pure: no DOM, no I/O, no module state. Everything the rules need — the resolved absences,
 * the exclusion list, the thresholds — arrives in `cfg`. The legacy version read a module
 * global (`ausenciasMap`), which is why it could not be tested.
 */

import {
  ID_OLVIDO_FICHAR,
  RE_OLVIDO_FICHAR,
  clasificarPartes,
} from './motivos.js';
import {
  celdaTexto,
  fmtFechaISO,
  fmtMinutos,
  fmtReloj,
  infoTurno,
  lunesDe,
  parsearFechaDMY,
  parsearHM,
  parsearMovimientos,
} from './parseo.js';
import type {
  ConfiguracionFichadas,
  Falta,
  FilaQuickpass,
  OrigenMotivo,
  RegistroDia,
} from './tipos.js';

/** Fichadas required when the sector has no explicit rule: in / break out / break in / out. */
const FICHADAS_REQUERIDAS_POR_DEFECTO = 4;
const DESCANSO_MAX_POR_DEFECTO = 30;
const TOLERANCIA_POR_DEFECTO = 0;

/** Key of a human decision over a (dni, fecha). `fechaStr` is the raw cell, not the Date. */
export function claveAusencia(dni: string, fechaStr: string): string {
  return dni + '|' + fechaStr;
}

export function construirRegistroDia(
  fila: FilaQuickpass,
  cfg: ConfiguracionFichadas = {},
): RegistroDia {
  const sector = celdaTexto(fila['Sector']);
  const usuario = celdaTexto(fila['Usuario']);
  const dni = celdaTexto(fila['DNI']);
  const legajo = celdaTexto(fila['Legajo']);
  const fechaStr = celdaTexto(fila['Fecha']);
  const fecha = parsearFechaDMY(fila['Fecha']);
  const movimientos = parsearMovimientos(fila['Movimientos']);
  const turno = infoTurno(fila['Turno']);
  // A sector rule of 0 is meaningless and falls back to 4, same as a missing one.
  const fichadasRequeridas =
    cfg.reglasSector?.[sector] || FICHADAS_REQUERIDAS_POR_DEFECTO;
  const partesRaw = celdaTexto(fila['Partes']);

  const descansoMax = cfg.descansoMaxMin ?? DESCANSO_MAX_POR_DEFECTO;
  const tolerancia = cfg.toleranciaMin ?? TOLERANCIA_POR_DEFECTO;

  const excluido = (cfg.dniExcluidos ?? []).indexOf(dni) !== -1;

  const base = {
    sector,
    usuario,
    dni,
    legajo,
    fecha,
    fechaStr,
    inicioSemana: fecha ? fmtFechaISO(lunesDe(fecha)) : null,
    cantidadMovimientos: movimientos.length,
    movimientos,
    turnoRaw: celdaTexto(fila['Turno']),
    esDiaLibre: turno.esDiaLibre,
    esFlexible: turno.esFlexible,
    inicioTurno: turno.inicio,
    fichadasRequeridas,
    horasTurno: parsearHM(fila['Horas Turno']),
    horasBrutas: parsearHM(fila['Horas']),
    cantidadTarde: parsearHM(fila['Cantidad Tarde']),
    partesRaw,
    excluido,
  };

  // A franco is not a workday: it never reaches fault or absence processing.
  if (turno.esDiaLibre) {
    return { ...base, descansoReal: 0, faltas: [], tipoDia: 'libre', motivoId: null, motivoSource: null };
  }

  if (movimientos.length === 0) {
    // Nobody punched. RRHH's own resolution, if there is one, outranks the QUICKPASS note.
    const guardada = cfg.ausencias?.[claveAusencia(dni, fechaStr)];
    let motivoId: number | null = null;
    let motivoSource: OrigenMotivo | null = null;
    if (guardada && guardada.motivoId) {
      motivoId = guardada.motivoId;
      motivoSource = guardada.motivoSource ?? 'manual';
    } else {
      const desdePartes = clasificarPartes(partesRaw);
      if (desdePartes) {
        motivoId = desdePartes;
        motivoSource = 'partes';
      }
    }

    // "Olvidó fichar" is the one dual motivo: the day is an absence (so the registry and the
    // hours report see it) AND it raises a Fichadas Incompletas fault, because the person
    // ultimately never clocked in. Every other motivo only affects worked / not worked.
    const faltas: Falta[] = [];
    if (motivoId === ID_OLVIDO_FICHAR && !excluido) {
      faltas.push({
        tipo: 'incompleta',
        detalle: '0 de ' + fichadasRequeridas + ' fichadas — parte QUICKPASS: ' + partesRaw.trim(),
        olvidoFichar: true,
      });
    }

    return { ...base, descansoReal: 0, faltas, tipoDia: 'ausencia', motivoId, motivoSource };
  }

  // A real break can only be measured when the day has an out/in pair in the middle.
  const descansoReal =
    fichadasRequeridas === 4 && movimientos.length >= 3
      ? (movimientos[2] as number) - (movimientos[1] as number)
      : 0;

  // An excluded person still gets the full record — their hours keep counting in the Horas
  // Trabajadas report — but produces no faults, because faults are what gets them notified.
  if (excluido) {
    return { ...base, descansoReal, faltas: [], tipoDia: 'trabajo', motivoId: null, motivoSource: null };
  }

  const faltas: Falta[] = [];

  const olvidoFichar = RE_OLVIDO_FICHAR.test(partesRaw);
  if (movimientos.length < fichadasRequeridas || olvidoFichar) {
    let detalle = movimientos.length + ' de ' + fichadasRequeridas + ' fichadas';
    if (olvidoFichar) detalle += ' — parte QUICKPASS: ' + partesRaw.trim();
    faltas.push({ tipo: 'incompleta', detalle, olvidoFichar });
  }

  if (fichadasRequeridas === 4 && movimientos.length >= 3 && descansoReal > descansoMax) {
    faltas.push({
      tipo: 'descanso',
      detalle: fmtMinutos(descansoReal) + ' de descanso (máx ' + descansoMax + ' min)',
    });
  }

  // A flexible shift has no start time to be late against, so it can never be a tardanza.
  if (!turno.esFlexible && base.cantidadTarde > tolerancia && turno.inicio !== null) {
    faltas.push({
      tipo: 'tardanza',
      detalle: fmtMinutos(base.cantidadTarde) + ' tarde (turno ' + fmtReloj(turno.inicio) + ')',
    });
  }

  return { ...base, descansoReal, faltas, tipoDia: 'trabajo', motivoId: null, motivoSource: null };
}
