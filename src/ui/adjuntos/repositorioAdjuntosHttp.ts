import { esObjeto, pedir, pedirJson } from '../http.js';
import type { Adjunto, RepositorioAdjuntos } from './RepositorioAdjuntos.js';

function esDatosAdjunto(valor: unknown): valor is Omit<Adjunto, 'id'> & { id: unknown } {
  return (
    esObjeto(valor) &&
    typeof valor['dni'] === 'string' &&
    typeof valor['fecha'] === 'string' &&
    typeof valor['nombre'] === 'string' &&
    typeof valor['bytes'] === 'number'
  );
}

function leerAdjunto(valor: unknown): Adjunto | null {
  if (!esDatosAdjunto(valor)) return null;
  const id = typeof valor.id === 'string' ? valor.id :
    typeof valor.id === 'number' && Number.isSafeInteger(valor.id) ? String(valor.id) : null;
  // Never pass a bigint through Number: attachment URLs must preserve every digit.
  return id !== null && /^[1-9][0-9]{0,18}$/.test(id) ? { ...valor, id } : null;
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
      return cuerpo['adjuntos'].map(leerAdjunto).filter((adjunto): adjunto is Adjunto => adjunto !== null);
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
      const adjunto = esObjeto(cuerpo) ? leerAdjunto(cuerpo['adjunto']) : null;
      if (adjunto === null) {
        throw new Error('El archivo se envió pero el servidor no informó cómo lo guardó.');
      }
      return adjunto;
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
