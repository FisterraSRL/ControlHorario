import { useCallback, useRef, useState } from 'react';
import type { DragEvent } from 'react';

import './Dropzone.css';

export interface DropzoneProps {
  /** Handed the picked file and nothing else — this component never reads it. */
  readonly onArchivo: (archivo: File) => void;
  readonly accept: string;
  readonly titulo: string;
  readonly ayuda: string;
  readonly disabled?: boolean;
}

/**
 * Presentational: it produces a `File` and hands it up. It does not read it, parse it or
 * know what a fichada is.
 *
 * It is a real `<button>` rather than a div with a click handler, so it is reachable by
 * keyboard and announced as a control without any role/tabindex bookkeeping.
 */
export function Dropzone({ onArchivo, accept, titulo, ayuda, disabled = false }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrastrando, setArrastrando] = useState(false);

  const alSoltar = useCallback(
    (e: DragEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setArrastrando(false);
      if (disabled) return;
      const archivo = e.dataTransfer.files.item(0);
      if (archivo) onArchivo(archivo);
    },
    [disabled, onArchivo],
  );

  const alArrastrar = useCallback(
    (e: DragEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (!disabled) setArrastrando(true);
    },
    [disabled],
  );

  return (
    <>
      <button
        type="button"
        className={`dropzone${arrastrando ? ' dropzone--activa' : ''}`}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={alArrastrar}
        onDragEnter={alArrastrar}
        onDragLeave={() => setArrastrando(false)}
        onDrop={alSoltar}
      >
        <strong className="dropzone__titulo">{titulo}</strong>
        <span className="dropzone__ayuda">{ayuda}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        className="dropzone__input"
        accept={accept}
        tabIndex={-1}
        onChange={(e) => {
          const archivo = e.target.files?.item(0);
          if (archivo) onArchivo(archivo);
          // Cleared so that picking the same file twice in a row fires `change` again.
          e.target.value = '';
        }}
      />
    </>
  );
}
