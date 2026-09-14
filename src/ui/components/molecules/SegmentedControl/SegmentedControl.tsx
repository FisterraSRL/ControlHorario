import './SegmentedControl.css';

export interface OpcionSegmento<T extends string> {
  readonly valor: T;
  readonly label: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly opciones: readonly OpcionSegmento<T>[];
  readonly valor: T;
  readonly onCambio: (valor: T) => void;
  /** Names the group for screen readers, e.g. "Modo de período". */
  readonly etiqueta: string;
}

/**
 * Presentational. A radio group, not a row of buttons: exactly one option is always
 * selected, and arrow keys should move between them the way a radio group does.
 */
export function SegmentedControl<T extends string>({
  opciones,
  valor,
  onCambio,
  etiqueta,
}: SegmentedControlProps<T>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={etiqueta}>
      {opciones.map((opcion) => (
        <button
          key={opcion.valor}
          type="button"
          role="radio"
          aria-checked={opcion.valor === valor}
          className={`segmented__opcion${opcion.valor === valor ? ' segmented__opcion--on' : ''}`}
          onClick={() => onCambio(opcion.valor)}
        >
          {opcion.label}
        </button>
      ))}
    </div>
  );
}
