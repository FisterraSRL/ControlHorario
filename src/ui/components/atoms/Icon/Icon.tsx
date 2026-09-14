import './Icon.css';

/**
 * The small closed set of line icons the shell needs.
 *
 * They are drawn here rather than pulled from an icon package for the same reason the fonts
 * are self-hosted: this is an internal payroll tool and every avoidable third-party
 * dependency is one more thing to audit. Six glyphs do not justify a library.
 *
 * The legacy file used emoji, which render in colour on some machines and as monochrome
 * glyphs on others, at sizes the surrounding text does not control.
 */
export type NombreIcono =
  | 'carga'
  | 'notificaciones'
  | 'ausencias'
  | 'indicador'
  | 'horas'
  | 'configuracion'
  | 'anterior'
  | 'siguiente';

const TRAZOS: Readonly<Record<NombreIcono, readonly string[]>> = {
  carga: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 20h16'],
  notificaciones: ['M12 3.5 21.5 20h-19z', 'M12 10v4', 'M12 17h.01'],
  ausencias: ['M9 3.5h6v3H9z', 'M9 5H6v15.5h12V5h-3', 'M9 11h6', 'M9 15h4'],
  indicador: ['M4 20V11', 'M10 20V4', 'M16 20v-6', 'M2 20h20'],
  horas: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7.5V12l3 2'],
  configuracion: ['M3 8h9', 'M17 8h4', 'M3 16h5', 'M13 16h8'],
  anterior: ['M15 5l-7 7 7 7'],
  siguiente: ['M9 5l7 7-7 7'],
};

const CIRCULOS: Partial<Record<NombreIcono, readonly (readonly [number, number])[]>> = {
  configuracion: [
    [14.5, 8],
    [10.5, 16],
  ],
};

export function Icon({ nombre }: { readonly nombre: NombreIcono }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {TRAZOS[nombre].map((d) => (
        <path key={d} d={d} />
      ))}
      {(CIRCULOS[nombre] ?? []).map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.2" />
      ))}
    </svg>
  );
}
