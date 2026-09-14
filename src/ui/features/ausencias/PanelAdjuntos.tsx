import { useRef } from 'react';

import { Button } from '../../components/atoms/Button/Button.js';
import { Chip } from '../../components/atoms/Chip/Chip.js';
import type { Adjunto } from '../../adjuntos/RepositorioAdjuntos.js';
import { fmtBytes } from './ausencias.js';

export interface PanelAdjuntosProps {
  readonly adjuntos: readonly Adjunto[];
  /** `false` offline: there is nowhere safe to keep a medical certificate in a browser. */
  readonly disponible: boolean;
  readonly ocupado: boolean;
  readonly onSubir: (archivos: readonly File[]) => void;
  readonly onDescargar: (adjunto: Adjunto) => void;
  readonly onEliminar: (adjunto: Adjunto) => void;
}

/**
 * Presentational. The expandable panel under an absence row.
 *
 * THERE IS NO LINK TO THE FILE. The legacy panel rendered an `<a href="attachments/…">`
 * beside every attachment, which is a URL that works for whoever has it. These are medical
 * certificates: the only way to read one is the download button, which fetches it through
 * an authenticated request and hands the browser a Blob. See `rutasAdjuntos.ts`.
 */
export function PanelAdjuntos({
  adjuntos,
  disponible,
  ocupado,
  onSubir,
  onDescargar,
  onEliminar,
}: PanelAdjuntosProps) {
  const entrada = useRef<HTMLInputElement>(null);

  if (!disponible) {
    return (
      <div className="adjuntos">
        <p className="adjuntos__vacio">
          Los adjuntos necesitan el servidor. Esta pantalla está funcionando solo con el
          almacenamiento de este navegador, donde un certificado médico no puede guardarse de
          forma segura ni compartirse con nadie.
        </p>
      </div>
    );
  }

  return (
    <div className="adjuntos">
      <div className="adjuntos__acciones">
        <input
          ref={entrada}
          className="adjuntos__entrada"
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
          disabled={ocupado}
          onChange={(e) => {
            const archivos = [...(e.target.files ?? [])];
            // Cleared so choosing the same file twice in a row still fires a change.
            e.target.value = '';
            if (archivos.length > 0) onSubir(archivos);
          }}
        />
        <Button tamano="sm" disabled={ocupado} onClick={() => entrada.current?.click()}>
          {ocupado ? 'Subiendo…' : 'Adjuntar archivo'}
        </Button>
        <span className="adjuntos__ayuda">PDF o foto (JPG, PNG, WEBP, HEIC), hasta 10 MB.</span>
      </div>

      {adjuntos.length === 0 ? (
        <p className="adjuntos__vacio">Sin adjuntos todavía.</p>
      ) : (
        <ul className="adjuntos__lista">
          {adjuntos.map((adjunto) => (
            <li key={adjunto.id} className="adjuntos__item">
              <span className="adjuntos__nombre" title={adjunto.nombre}>
                {adjunto.nombre}
              </span>
              <Chip tono="neutral">{fmtBytes(adjunto.bytes)}</Chip>
              <Button
                tamano="sm"
                variante="ghost"
                disabled={ocupado}
                onClick={() => onDescargar(adjunto)}
              >
                Descargar
              </Button>
              <Button
                tamano="sm"
                variante="ghost"
                disabled={ocupado}
                onClick={() => onEliminar(adjunto)}
              >
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
