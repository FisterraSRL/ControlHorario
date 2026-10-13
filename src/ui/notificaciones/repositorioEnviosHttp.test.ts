import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearRepositorioEnviosHttp } from './repositorioEnviosHttp.js';
afterEach(()=>vi.unstubAllGlobals());
describe('whole-history HTTP reads',()=>{
  it('encodes literal search and combines optional filters in one authenticated read',async()=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify({documentos:[],anteriores:[],hayMas:false}),{status:200}));vi.stubGlobal('fetch',fetch);
    await crearRepositorioEnviosHttp('/api').historial(3,{busqueda:'A&B; %',sector:'Sector prueba',desde:'2026-10-01',hasta:'2026-10-02',marcas:'con'});
    const [url,options]=fetch.mock.calls[0] as unknown as [string,RequestInit];
    const params=new URL(url,'http://localhost').searchParams;
    expect(Object.fromEntries(params)).toEqual({pagina:'3',busqueda:'A&B; %',sector:'Sector prueba',desde:'2026-10-01',hasta:'2026-10-02',marcas:'con'});
    expect(options.credentials).toBe('include');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('blocks invalid dates before a network call',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await expect(crearRepositorioEnviosHttp('/api').historial(0,{desde:'2026-10-05',hasta:'2026-10-01'})).rejects.toThrow('posterior');
    expect(fetch).not.toHaveBeenCalled();
  });
});
