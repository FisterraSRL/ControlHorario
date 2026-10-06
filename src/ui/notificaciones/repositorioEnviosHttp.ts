import { esSnapshot, type DocumentoPendiente, type DocumentoEmitido, type HistorialEnvios, type RepositorioEnvios } from '../../notificaciones/envios.js';
import { conJson, esObjeto, pedirJson } from '../http.js';
function documentos(v: unknown): readonly DocumentoPendiente[] {
  if (!esObjeto(v) || !Array.isArray(v['documentos']) || !v['documentos'].every(d => esObjeto(d) && typeof d['id'] === 'string' && typeof d['creadoAt'] === 'string' && esSnapshot(d['snapshot']))) throw new Error('El servidor devolvió documentos que no se pueden leer. Recargá la página.');
  return v['documentos'] as DocumentoPendiente[];
}
export function crearRepositorioEnviosHttp(base: string): RepositorioEnvios {
  const raiz = `${base}/envios`;
  return {
    pendientes: async () => documentos(await pedirJson(`${raiz}/pendientes`)),
    async encolar(docs) { await pedirJson(`${raiz}/pendientes`, conJson('POST', { documentos: docs })); },
    async descartar(id) { await pedirJson(`${raiz}/descartar`, conJson('POST', { id })); },
    async emitir(pedido) {
      const cuerpo = await pedirJson(`${raiz}/emitir`, conJson('POST', pedido));
      const docs = documentos(cuerpo);
      if (!docs.every(d => 'emisionId' in d && 'fechaDocumento' in d && 'activas' in d)) throw new Error('La emisión no se confirmó. Revisá el historial antes de reintentar.');
      return docs as readonly DocumentoEmitido[];
    },
    async historial(pagina) {
      const cuerpo = await pedirJson(`${raiz}/historial?pagina=${pagina}`);
      documentos(cuerpo);
      if (!esObjeto(cuerpo) || !Array.isArray(cuerpo['anteriores']) || typeof cuerpo['hayMas'] !== 'boolean') throw new Error('No se pudo leer el historial.');
      return cuerpo as unknown as HistorialEnvios;
    },
    async quitar(marcas) { await pedirJson(`${raiz}/quitar-notificado`, conJson('POST', { marcas })); },
  };
}
