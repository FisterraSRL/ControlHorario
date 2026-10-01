import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { Icon } from '../../atoms/Icon/Icon.js';
import {
  COLUMNAS_SEMANA,
  alElegir,
  bandaVisible,
  claveDia,
  diaUTC,
  esDelMes,
  estadoDia,
  etiquetaDia,
  mesDe,
  mismoDia,
  mismoDiaEnOtroMes,
  moverFoco,
  semanasDelMes,
  sumarMeses,
  tituloMes,
  type Mes,
} from './grillaMes.js';
import './Calendario.css';

export interface CalendarioProps {
  /** The range in force, painted when the calendar opens. UTC midnight. */
  readonly desde: Date;
  readonly hasta: Date;
  /** The operator's today at UTC midnight. A prop, so the grid never reads a clock itself. */
  readonly hoy: Date;
  /** Fired once, on the second click, with `desde <= hasta`. */
  readonly onElegir: (desde: Date, hasta: Date) => void;
}

/**
 * Presentational. A month grid that takes a range in two clicks: the first sets Desde, the
 * second sets Hasta. Where it lives — a popover, a panel — and what happens to the chosen
 * range are the caller's business; closing on Esc or on a click outside belongs to that
 * container too.
 *
 * The state it does keep is view state only (the month on screen, the pending Desde, the
 * day under the pointer, the focused day), and it is thrown away on unmount: the caller
 * mounts it on open, so every opening starts from the range in force.
 *
 * Accessibility follows the WAI-ARIA date-picker grid: one tab stop in the grid (roving
 * `tabIndex`), arrows/Home/End/PageUp/PageDown move it, every day is a real `<button>` whose
 * label is the full date, and the selection is exposed as `aria-selected` on the cell and as
 * shape (filled caps, a band, a ring for today), never as colour alone.
 */
export function Calendario({ desde, hasta, hoy, onElegir }: CalendarioProps) {
  const [visible, setVisible] = useState<Mes>(() => mesDe(hasta));
  const [foco, setFoco] = useState<Date>(hasta);
  const [pendiente, setPendiente] = useState<Date | null>(null);
  const [sobre, setSobre] = useState<Date | null>(null);
  // Set when the next render must move DOM focus to `foco`: on open and after a key. Not on a
  // click or a month arrow, where the operator's focus is already where they put it.
  const enfocar = useRef(true);
  const grilla = useRef<HTMLTableElement>(null);
  const idTitulo = useId();
  const idPista = useId();

  const semanas = semanasDelMes(visible);
  const primera = semanas[0]?.[0];
  const ultima = semanas[semanas.length - 1]?.[6];
  const focoEnGrilla = primera !== undefined && ultima !== undefined && foco >= primera && foco <= ultima;
  // Exactly one day is reachable with Tab. If the focused day scrolled out of view with the
  // month arrows, the 1st of the visible month stands in for it.
  const tabulable = focoEnGrilla ? foco : diaUTC(visible.anio, visible.mes, 1);
  const banda = bandaVisible({ desde, hasta }, pendiente, sobre);

  useEffect(() => {
    if (!enfocar.current) return;
    enfocar.current = false;
    grilla.current?.querySelector<HTMLButtonElement>(`[data-dia="${claveDia(foco)}"]`)?.focus();
  }, [foco, visible]);

  function irA(dia: Date) {
    enfocar.current = true;
    setFoco(dia);
    if (!esDelMes(dia, visible)) setVisible(mesDe(dia));
  }

  function cambiarMes(n: number) {
    const destino = sumarMeses(visible, n);
    setVisible(destino);
    setFoco(mismoDiaEnOtroMes(foco, n));
  }

  function alTeclear(evento: KeyboardEvent<HTMLButtonElement>, dia: Date) {
    const destino = moverFocoDesde(dia, evento);
    if (!destino) return;
    evento.preventDefault();
    irA(destino);
  }

  function alClick(dia: Date) {
    const resultado = alElegir(pendiente, dia);
    if (resultado.tipo === 'completo') {
      onElegir(resultado.desde, resultado.hasta);
      return;
    }
    setPendiente(resultado.desde);
    setSobre(dia);
    setFoco(dia);
  }

  return (
    <div className="calendario">
      <div className="calendario__cabecera">
        <button
          type="button"
          className="calendario__nav"
          onClick={() => cambiarMes(-1)}
          aria-label="Mes anterior"
        >
          <Icon nombre="anterior" />
        </button>
        <span className="calendario__titulo" id={idTitulo} aria-live="polite">
          {tituloMes(visible)}
        </span>
        <button
          type="button"
          className="calendario__nav"
          onClick={() => cambiarMes(1)}
          aria-label="Mes siguiente"
        >
          <Icon nombre="siguiente" />
        </button>
      </div>

      <p className="calendario__pista" id={idPista} aria-live="polite">
        {pendiente ? 'Elegí la fecha hasta' : 'Elegí la fecha desde'}
      </p>

      <table
        ref={grilla}
        className="calendario__grilla"
        role="grid"
        aria-labelledby={idTitulo}
        aria-describedby={idPista}
        onMouseLeave={() => setSobre(null)}
      >
        <thead>
          <tr>
            {COLUMNAS_SEMANA.map((c) => (
              <th key={c.larga} scope="col" className="calendario__columna">
                <span aria-hidden="true">{c.corta}</span>
                <span className="calendario__sr">{c.larga}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {semanas.map((semana, fila) => (
            // Six positional rows that are rebuilt per month: the index IS the identity.
            <tr key={fila}>
              {semana.map((dia) => {
                const { inicio, fin, medio } = estadoDia(dia, banda);
                const esHoy = mismoDia(dia, hoy);
                const elegido = inicio || fin || medio;
                const celda = [
                  'calendario__celda',
                  medio && 'calendario__celda--medio',
                  inicio && !fin && 'calendario__celda--inicio',
                  fin && !inicio && 'calendario__celda--fin',
                ];
                const boton = [
                  'calendario__dia',
                  !esDelMes(dia, visible) && 'calendario__dia--fuera',
                  (inicio || fin) && 'calendario__dia--extremo',
                  esHoy && 'calendario__dia--hoy',
                ];
                return (
                  <td
                    key={claveDia(dia)}
                    role="gridcell"
                    aria-selected={elegido}
                    className={celda.filter(Boolean).join(' ')}
                  >
                    <button
                      type="button"
                      data-dia={claveDia(dia)}
                      className={boton.filter(Boolean).join(' ')}
                      tabIndex={mismoDia(dia, tabulable) ? 0 : -1}
                      aria-label={etiquetaAccesible(dia, inicio, fin, pendiente)}
                      aria-current={esHoy ? 'date' : undefined}
                      onClick={() => alClick(dia)}
                      onKeyDown={(e) => alTeclear(e, dia)}
                      onMouseEnter={() => pendiente && setSobre(dia)}
                      onFocus={() => {
                        // Keyboard users get the same preview the pointer does.
                        if (pendiente) setSobre(dia);
                      }}
                    >
                      {dia.getUTCDate()}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="calendario__pie">
        <button
          type="button"
          className="calendario__hoy"
          onClick={() => irA(hoy)}
          aria-label={`Ir a hoy, ${etiquetaDia(hoy)}`}
        >
          Hoy
        </button>
      </div>
    </div>
  );
}

function moverFocoDesde(dia: Date, evento: KeyboardEvent<HTMLButtonElement>): Date | null {
  // Ctrl/Alt/Meta combinations belong to the browser and the screen reader.
  if (evento.ctrlKey || evento.altKey || evento.metaKey) return null;
  return moverFoco(dia, evento.key, evento.shiftKey);
}

/**
 * The full date, plus which end it is. While Desde is pending the band is only a preview —
 * and if the pointer is on an earlier day the preview's start is not Desde at all — so only
 * the pending day itself is announced; nothing is called Hasta until it is clicked.
 */
function etiquetaAccesible(
  dia: Date,
  inicio: boolean,
  fin: boolean,
  pendiente: Date | null,
): string {
  const base = etiquetaDia(dia);
  if (pendiente) return mismoDia(dia, pendiente) ? `${base}, fecha desde elegida` : base;
  if (inicio && fin) return `${base}, desde y hasta`;
  if (inicio) return `${base}, desde`;
  if (fin) return `${base}, hasta`;
  return base;
}
