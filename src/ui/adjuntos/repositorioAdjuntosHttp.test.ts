import { afterEach, describe, expect, it, vi } from 'vitest';

import { crearRepositorioAdjuntosHttp } from './repositorioAdjuntosHttp.js';

const BASE = '/api';
const ATTACHMENT = {
  id: '4', dni: 'TEST', fecha: '2026-10-13', nombre: 'proof.txt', bytes: 68,
  tipoMime: 'text/plain', subidoPor: null, subidoAt: '2026-10-13T12:00:00Z',
};

function respond(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('attachment HTTP identifiers', () => {
  it('accepts the string bigint returned after a successful production upload', async () => {
    const fetchMock = respond({ adjunto: ATTACHMENT });
    const file = new File(['Test attachment'], 'proof.txt', { type: 'text/plain' });
    const attachment = await crearRepositorioAdjuntosHttp(BASE).subir('TEST', '13/10/2026', file);
    expect(attachment).toEqual(ATTACHMENT);
    expect(fetchMock).toHaveBeenCalledWith('/api/adjuntos', expect.objectContaining({
      method: 'POST', credentials: 'include', body: expect.any(FormData),
    }));
  });

  it('retains string identifiers when listing saved attachments', async () => {
    respond({ adjuntos: [ATTACHMENT, { ...ATTACHMENT, id: '9007199254740993' }] });
    const attachments = await crearRepositorioAdjuntosHttp(BASE).listar();
    expect(attachments.map(attachment => attachment.id)).toEqual(['4', '9007199254740993']);
  });

  it('uses the exact large identifier for authenticated download and deletion', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ adjuntos: [{ ...ATTACHMENT, id: '9007199254740993' }] }))
      .mockResolvedValueOnce(new Response('Test attachment'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const repository = crearRepositorioAdjuntosHttp(BASE);
    const [attachment] = await repository.listar();
    expect(attachment).toBeDefined();
    const content = await repository.descargar(attachment!.id);
    expect(await content.text()).toBe('Test attachment');
    await repository.eliminar(attachment!.id);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/adjuntos/9007199254740993/archivo',
      expect.objectContaining({ method: 'GET', credentials: 'include' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/adjuntos/9007199254740993',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }));
  });

  it('normalizes safe numeric legacy identifiers for uploads and lists', async () => {
    respond({ adjunto: { ...ATTACHMENT, id: 4 } });
    const repository = crearRepositorioAdjuntosHttp(BASE);
    expect((await repository.subir('TEST', '13/10/2026', new File(['proof'], 'proof.txt'))).id).toBe('4');
    respond({ adjuntos: [{ ...ATTACHMENT, id: 4 }] });
    expect((await repository.listar())[0]?.id).toBe('4');
  });

  it.each(['0', '-1', '1.5', ' 4', '4 ', '04', '1/archivo', '', 0, -1, 1.5,
    Number.MAX_SAFE_INTEGER + 1, null])('rejects malformed or unsafe identifier %s', async id => {
    const repository = crearRepositorioAdjuntosHttp(BASE);
    respond({ adjuntos: [{ ...ATTACHMENT, id }] });
    expect(await repository.listar()).toEqual([]);
    respond({ adjunto: { ...ATTACHMENT, id } });
    await expect(repository.subir('TEST', '13/10/2026', new File(['proof'], 'proof.txt')))
      .rejects.toThrow('El archivo se envió pero el servidor no informó cómo lo guardó.');
  });
});
