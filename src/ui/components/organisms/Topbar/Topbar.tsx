import { Button } from '../../atoms/Button/Button.js';
import { Chip } from '../../atoms/Chip/Chip.js';
import { Icon } from '../../atoms/Icon/Icon.js';
import { SegmentedControl } from '../../molecules/SegmentedControl/SegmentedControl.js';
import type { OpcionSegmento } from '../../molecules/SegmentedControl/SegmentedControl.js';
import './Topbar.css';

export interface TopbarProps<T extends string> {
  readonly titulo: string;
  /** Cargar datos has no period: an upload writes into the whole historial. */
  readonly mostrarPeriodo: boolean;
  readonly modos: readonly OpcionSegmento<T>[];
  readonly modoActivo: T;
  readonly onModo: (modo: T) => void;
  readonly onDesplazar: (direccion: 1 | -1) => void;
  /** `14 sep 2026` — the anchor. */
  readonly etiquetaAncla: string;
  /** `14/09/2026 – 20/09/2026` — the window the anchor resolves to. */
  readonly etiquetaRango: string;
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

/** Presentational. It renders the period controls; it does not own the period. */
export function Topbar<T extends string>({
  titulo,
  mostrarPeriodo,
  modos,
  modoActivo,
  onModo,
  onDesplazar,
  etiquetaAncla,
  etiquetaRango,
  operador,
  onSalir,
  sinServidor,
}: TopbarProps<T>) {
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
          <button
            type="button"
            className="topbar__paso"
            onClick={() => onDesplazar(-1)}
            aria-label="Período anterior"
          >
            <Icon nombre="anterior" />
          </button>
          <span className="topbar__ancla">{etiquetaAncla}</span>
          <button
            type="button"
            className="topbar__paso"
            onClick={() => onDesplazar(1)}
            aria-label="Período siguiente"
          >
            <Icon nombre="siguiente" />
          </button>
          <span className="topbar__rango">{etiquetaRango}</span>
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
