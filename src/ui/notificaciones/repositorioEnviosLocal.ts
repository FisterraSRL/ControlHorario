import { comprobarCola, clavesSnapshot, ConflictoEnvio, idMarca, TAMANO_HISTORIAL, type DocumentoPendiente, type DocumentoEmitido, type MarcaVersionada, type PedidoEmision, type RepositorioEnvios } from '../../notificaciones/envios.js';
import type { RepositorioNotificaciones } from './RepositorioNotificaciones.js';
import { CLAVE_ALMACEN_NOTIFICADAS } from './repositorioNotificacionesLocal.js';

export const CLAVE_ENVIOS = 'controlhorario.envios.v1';
interface Estado {
  pendientes: DocumentoPendiente[];
  documentos: Omit<DocumentoEmitido, 'activas'>[];
  marcas: Record<string, MarcaVersionada & { documentoId: string | null }>;
  emisiones: Record<string, PedidoEmision>;
  descartados: DocumentoPendiente[];
}
function storageDelNavegador(): Storage | null { try { return globalThis.localStorage ?? null; } catch { return null; } }

export function crearRepositoriosEnviosLocal(storage: Storage | null = storageDelNavegador(), ahora: () => Date = () => new Date()): { envios: RepositorioEnvios; notificaciones: RepositorioNotificaciones } {
  let memoria: Estado | null = null;
  function leer(): Estado {
    if (!storage && memoria) return structuredClone(memoria);
    try {
      const crudo = storage?.getItem(CLAVE_ENVIOS);
      if (crudo) {
        const valor = JSON.parse(crudo) as Estado;
        if (!Array.isArray(valor.pendientes) || !Array.isArray(valor.documentos) || !valor.marcas || !valor.emisiones || !Array.isArray(valor.descartados)) throw new Error();
        return valor;
      }
      const estado: Estado = { pendientes: [], documentos: [], marcas: {}, emisiones: {}, descartados: [] };
      const viejas = storage?.getItem(CLAVE_ALMACEN_NOTIFICADAS);
      if (viejas) for (const [key, fecha] of Object.entries(JSON.parse(viejas) as Record<string, string>)) {
        const [dni, fechaIso, tipo] = key.split('|');
        if (dni && fechaIso && (tipo === 'incompleta' || tipo === 'descanso' || tipo === 'tardanza')) estado.marcas[key] = { dni, fechaIso, tipo, notificadoAt: fecha, version: crypto.randomUUID(), documentoId: null };
      }
      // Persist the migration once so legacy versions are stable across reads.
      guardar(estado);
      return estado;
    } catch { throw new Error('No se pudo leer el panel guardado en este navegador. No se modificaron los datos.'); }
  }
  function guardar(estado: Estado) {
    // ONE write owns queue, history and marks; quota failure leaves all three unchanged.
    if (storage) storage.setItem(CLAVE_ENVIOS, JSON.stringify(estado));
    memoria = structuredClone(estado);
  }
  async function escribir<T>(fn: (e: Estado) => T): Promise<T> {
    const trabajo = () => { const e = leer(); const resultado = fn(e); guardar(e); return resultado; };
    // Serialize read-modify-write across browser tabs where Web Locks are available.
    if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(CLAVE_ENVIOS, async () => trabajo());
    return trabajo();
  }
  const conMarcas = (e: Estado, d: Omit<DocumentoEmitido, 'activas'>): DocumentoEmitido => ({ ...d, activas: Object.values(e.marcas).filter(m => m.documentoId === d.id) });
  return {
    envios: {
      async pendientes() { return leer().pendientes; },
      async encolar(documentos) {
        await escribir(e => {
          const historicos = [...e.documentos, ...e.descartados];
          const nuevos = documentos.filter(d => {
            const previo = historicos.find(p => p.id === d.id);
            if (!previo) return true;
            if (JSON.stringify(previo.snapshot) !== JSON.stringify(d.snapshot)) throw new ConflictoEnvio('La preparación ya existe con otro contenido.');
            return false;
          });
          comprobarCola(e.pendientes, nuevos);
          for (const d of nuevos) if (!e.pendientes.some(p => p.id === d.id)) e.pendientes.push({ ...d, creadoAt: ahora().toISOString() });
        });
      },
      async descartar(id) {
        await escribir(e => {
          if (e.descartados.some(d => d.id === id)) return;
          const doc = e.pendientes.find(d => d.id === id);
          if (!doc) throw new ConflictoEnvio('El documento ya no está pendiente. Actualizá el panel.');
          e.descartados.push(doc);
          e.pendientes = e.pendientes.filter(d => d.id !== id);
        });
      },
      async emitir(pedido) {
        return escribir(e => {
          const previo = e.emisiones[pedido.id];
          if (previo) {
            if (JSON.stringify([...previo.documentos].sort()) !== JSON.stringify([...pedido.documentos].sort()) || previo.fechaDocumento !== pedido.fechaDocumento) throw new ConflictoEnvio('El identificador de emisión pertenece a otra selección.');
            return e.documentos.filter(d => d.emisionId === pedido.id).map(d => conMarcas(e, d));
          }
          const documentos = e.pendientes.filter(d => pedido.documentos.includes(d.id));
          if (documentos.length !== pedido.documentos.length) throw new ConflictoEnvio('Otro operador cambió los pendientes. Actualizá el panel antes de generar.');
          const emitidoAt = ahora().toISOString();
          for (const d of documentos) {
            e.documentos.unshift({ ...d, emisionId: pedido.id, emitidoAt, fechaDocumento: pedido.fechaDocumento });
            for (const c of clavesSnapshot(d.snapshot)) e.marcas[idMarca(c)] = { ...c, notificadoAt: emitidoAt, version: crypto.randomUUID(), documentoId: d.id };
          }
          e.pendientes = e.pendientes.filter(d => !pedido.documentos.includes(d.id));
          e.emisiones[pedido.id] = pedido;
          return e.documentos.filter(d => d.emisionId === pedido.id).map(d => conMarcas(e, d));
        });
      },
      async historial(pagina) {
        const e = leer(); const anteriores = Object.values(e.marcas).filter(m => !m.documentoId); const inicio = pagina * TAMANO_HISTORIAL;
        return { documentos: e.documentos.slice(inicio, inicio + TAMANO_HISTORIAL).map(d => conMarcas(e, d)), anteriores: anteriores.slice(inicio, inicio + TAMANO_HISTORIAL), hayMas: Math.max(e.documentos.length, anteriores.length) > inicio + TAMANO_HISTORIAL };
      },
      async quitar(marcas) {
        await escribir(e => { for (const m of marcas) if (e.marcas[idMarca(m)]?.version === m.version) delete e.marcas[idMarca(m)]; });
      },
    },
    notificaciones: {
      async listar(desde, hasta) { return Object.values(leer().marcas).filter(m => m.fechaIso >= desde && m.fechaIso <= hasta).map(m => ({ dni: m.dni, fecha: m.fechaIso, tipo: m.tipo, notificadoAt: m.notificadoAt })); },
      async registrar(claves) { await escribir(e => { for (const c of claves) if (!e.marcas[idMarca(c)]) e.marcas[idMarca(c)] = { ...c, notificadoAt: ahora().toISOString(), version: crypto.randomUUID(), documentoId: null }; }); },
    },
  };
}
