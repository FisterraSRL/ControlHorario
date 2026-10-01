import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { Button } from '../../atoms/Button/Button.js';
import { Chip } from '../../atoms/Chip/Chip.js';
import { Icon } from '../../atoms/Icon/Icon.js';
import { Calendario } from '../../molecules/Calendario/Calendario.js';
import { SegmentedControl } from '../../molecules/SegmentedControl/SegmentedControl.js';
import type { OpcionSegmento } from '../../molecules/SegmentedControl/SegmentedControl.js';
import './Topbar.css';

export interface TopbarProps<T extends string> {
  readonly titulo: string;
  /** Cargar datos has no period: an upload writes into the whole historial. */
  readonly mostrarPeriodo: boolean;
  readonly modos: readonly OpcionSegmento<T>[];
  /** `null` while a hand-picked range is in force: no preset describes it. */
  readonly modoActivo: T | null;
  readonly onModo: (modo: T) => void;
  readonly onDesplazar: (direccion: 1 | -1) => void;
  /** `14 sep 2026` — the anchor; or both ends of a hand-picked range. */
  readonly etiquetaAncla: string;
  /**
   * `14/09/2026 – 20/09/2026` — the window the anchor resolves to. `null` hides it, for a
   * range whose button already spells both ends: saying it twice costs a whole line on a
   * phone.
   */
  readonly etiquetaRango: string | null;
  /** The window in force, painted on the calendar when it opens. UTC midnight. */
  readonly rango: { readonly desde: Date; readonly hasta: Date };
  /** The operator's today at UTC midnight, marked on the calendar. */
  readonly hoy: Date;
  /** The two clicks on the calendar, `desde <= hasta`. */
  readonly onRango: (desde: Date, hasta: Date) => void;
  /** Who is logged in. Null offline, where there is nobody to be. */
  readonly operador: string | null;
  readonly onSalir: () => void;
  /**
   * `true` when this build has no server: everything lives in this browser, there is no
   * login, and there are no attachments. Said out loud rather than left to be discovered —
   * "the upload said it saved but nobody else can see it" is the confusion this prevents.
   */
  readonly sinServidor: boolean;
}

/** The popover's width and the gutter it keeps from the viewport edges. */
const ANCHO_POPOVER = 300;
const MARGEN = 16;

interface Posicion {
  readonly top: number;
  readonly left: number;
  readonly width: number;
}

/**
 * Presentational. It renders the period controls; it does not own the period. The one piece
 * of state it keeps is whether the calendar is open, which is nobody else's business.
 */
export function Topbar<T extends string>({
  titulo,
  mostrarPeriodo,
  modos,
  modoActivo,
  onModo,
  onDesplazar,
  etiquetaAncla,
  etiquetaRango,
  rango,
  hoy,
  onRango,
  operador,
  onSalir,
  sinServidor,
}: TopbarProps<T>) {
  const [abierto, setAbierto] = useState(false);
  const [posicion, setPosicion] = useState<Posicion | null>(null);
  const disparador = useRef<HTMLButtonElement>(null);
  const selector = useRef<HTMLDivElement>(null);
  const idPopover = useId();

  // Focus goes back to the trigger when the operator closes on purpose (Esc, a choice). Not
  // after a click elsewhere or a Tab out: that focus already went where they sent it.
  const cerrar = useCallback((devolverFoco: boolean) => {
    setAbierto(false);
    setPosicion(null);
    if (devolverFoco) disparador.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!abierto) return undefined;
    // `position: fixed`, measured from the trigger and clamped to the viewport. Anchoring it
    // with CSS alone would let it hang off the edge of a 375px screen, because where the
    // trigger lands depends on how the topbar wrapped.
    function ubicar() {
      const r = disparador.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(ANCHO_POPOVER, window.innerWidth - 2 * MARGEN);
      const centrado = r.left + r.width / 2 - width / 2;
      const left = Math.max(MARGEN, Math.min(centrado, window.innerWidth - MARGEN - width));
      setPosicion({ top: r.bottom + 6, left, width });
    }
    function alPulsarFuera(evento: PointerEvent) {
      if (evento.target instanceof Node && selector.current?.contains(evento.target)) return;
      cerrar(false);
    }
    ubicar();
    window.addEventListener('resize', ubicar);
    window.addEventListener('scroll', ubicar, true);
    document.addEventListener('pointerdown', alPulsarFuera);
    return () => {
      window.removeEventListener('resize', ubicar);
      window.removeEventListener('scroll', ubicar, true);
      document.removeEventListener('pointerdown', alPulsarFuera);
    };
  }, [abierto, cerrar]);

  function alTeclearPopover(evento: KeyboardEvent<HTMLDivElement>) {
    if (evento.key !== 'Escape') return;
    evento.preventDefault();
    evento.stopPropagation();
    cerrar(true);
  }

  function alElegir(desde: Date, hasta: Date) {
    onRango(desde, hasta);
    cerrar(true);
  }

  return (
    <header className="topbar">
      <h1 className="topbar__titulo">{titulo}</h1>

      {mostrarPeriodo && (
        <div className="topbar__periodo">
          <SegmentedControl
            opciones={modos}
            valor={modoActivo}
            onCambio={onModo}
            etiqueta="Modo de período"
          />
          {/* One unit, so a wrapping topbar never strands an arrow away from its label. */}
          <div className="topbar__navegacion">
            <button
              type="button"
              className="topbar__paso"
              onClick={() => onDesplazar(-1)}
              aria-label="Período anterior"
            >
              <Icon nombre="anterior" />
            </button>
            <div
              ref={selector}
              className="topbar__selector"
              onBlur={(evento) => {
                // A Tab out of the popover closes it. `relatedTarget` is null when the focused day
                // simply unmounted (the grid changed month), which must not count as leaving.
                const destino = evento.relatedTarget;
                if (abierto && destino instanceof Node && !evento.currentTarget.contains(destino)) {
                  cerrar(false);
                }
              }}
            >
              <button
                ref={disparador}
                type="button"
                className="topbar__ancla"
                aria-haspopup="dialog"
                aria-expanded={abierto}
                aria-controls={abierto ? idPopover : undefined}
                aria-label={`${etiquetaAncla}, elegir rango de fechas`}
                onClick={() => (abierto ? cerrar(true) : setAbierto(true))}
              >
                <Icon nombre="calendario" />
                <span>{etiquetaAncla}</span>
              </button>
              {abierto && posicion && (
                <div
                  id={idPopover}
                  className="topbar__popover"
                  role="dialog"
                  aria-label="Elegir rango de fechas"
                  style={{ top: posicion.top, left: posicion.left, width: posicion.width }}
                  onKeyDown={alTeclearPopover}
                >
                  <Calendario desde={rango.desde} hasta={rango.hasta} hoy={hoy} onElegir={alElegir} />
                </div>
              )}
            </div>
            <button
              type="button"
              className="topbar__paso"
              onClick={() => onDesplazar(1)}
              aria-label="Período siguiente"
            >
              <Icon nombre="siguiente" />
            </button>
          </div>
          {etiquetaRango !== null && <span className="topbar__rango">{etiquetaRango}</span>}
        </div>
      )}

      <div className="topbar__cuenta">
        {sinServidor ? (
          <Chip
            tono="incompleta"
            title="Sin servidor: los datos quedan solo en este navegador y los adjuntos no están disponibles."
          >
            Uso local
          </Chip>
        ) : (
          <>
            <span className="topbar__operador" title={operador ?? undefined}>
              {operador}
            </span>
            <Button tamano="sm" variante="ghost" onClick={onSalir}>
              Salir
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
