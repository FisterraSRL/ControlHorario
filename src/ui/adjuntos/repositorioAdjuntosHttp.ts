import { esObjeto, pedir, pedirJson } from '../http.js';
import type { Adjunto, RepositorioAdjuntos } from './RepositorioAdjuntos.js';

function esAdjunto(valor: unknown): valor is Adjunto {
  return (
    esObjeto(valor) &&
    typeof valor['id'] === 'number' &&
    typeof valor['dni'] === 'string' &&
    typeof valor['fecha'] === 'string' &&
    typeof valor['nombre'] === 'string' &&
    typeof valor['bytes'] === 'number'
  );
}

export function crearRepositorioAdjuntosHttp(base: string): RepositorioAdjuntos {
  const raiz = `${base}/adjuntos`;

  return {
    disponible: true,

    async listar() {
      const cuerpo = await pedirJson(raiz, { method: 'GET' });
      if (!esObjeto(cuerpo) || !Array.isArray(cuerpo['adjuntos'])) {
        throw new Error('El servidor devolvió los adjuntos en un formato inesperado.');
      }
      return cuerpo['adjuntos'].filter(esAdjunto);
    },

    async subir(dni, fechaStr, archivo) {
      const formulario = new FormData();
      formulario.append('dni', dni);
      formulario.append('fecha', fechaStr);
      // The third argument is the filename the server receives. It is data — it goes into
      // `adjuntos.nombre` — and it never becomes part of the path the file is stored under.
      formulario.append('archivo', archivo, archivo.name);
      // No `content-type` header: the browser has to set it, because only the browser knows
      // the multipart boundary it just generated.
      const cuerpo = await pedirJson(raiz, { method: 'POST', body: formulario });
      if (!esObjeto(cuerpo) || !esAdjunto(cuerpo['adjunto'])) {
        throw new Error('El archivo se envió pero el servidor no informó cómo lo guardó.');
      }
      return cuerpo['adjunto'];
    },

    async descargar(id) {
      const respuesta = await pedir(`${raiz}/${id}/archivo`, { method: 'GET' });
      return respuesta.blob();
    },

    async eliminar(id) {
      await pedir(`${raiz}/${id}`, { method: 'DELETE' });
    },
  };
}
