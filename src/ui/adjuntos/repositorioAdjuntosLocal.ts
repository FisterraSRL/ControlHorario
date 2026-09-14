/**
 * The offline attachments adapter: there are none, and it says so.
 *
 * A medical certificate does not go in localStorage. It is a few megabytes in a store meant
 * for a few kilobytes of strings, it is readable by anything running on this origin, it is
 * invisible to every other person who needs it, and it disappears the first time somebody
 * clears site data. The legacy file reached the same conclusion and printed the same kind of
 * sentence in the same place: "Los adjuntos necesitan el guardado compartido, que no está
 * disponible en este dispositivo ahora mismo."
 *
 * So `disponible` is `false`, the panel explains it, and the upload control is not rendered.
 * Every method still exists and throws with a readable message, so a caller that ignores the
 * flag fails loudly instead of silently losing a file.
 */

import { ErrorRepositorio } from '../historial/RepositorioFichadas.js';
import type { RepositorioAdjuntos } from './RepositorioAdjuntos.js';

const SIN_SERVIDOR =
  'Los adjuntos necesitan el servidor. Esta pantalla está funcionando solo con el ' +
  'almacenamiento de este navegador, donde un certificado médico no puede guardarse de ' +
  'forma segura ni compartirse con nadie.';

export function crearRepositorioAdjuntosLocal(): RepositorioAdjuntos {
  return {
    disponible: false,
    async listar() {
      return [];
    },
    async subir() {
      throw new ErrorRepositorio(SIN_SERVIDOR);
    },
    async descargar() {
      throw new ErrorRepositorio(SIN_SERVIDOR);
    },
    async eliminar() {
      throw new ErrorRepositorio(SIN_SERVIDOR);
    },
  };
}
