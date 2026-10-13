import { describe, expect, it, vi } from 'vitest';
import { crearConfirmacionUsuario } from './confirmacionUsuario.js';
const usuario = { id:'9007199254740993', nombre:'Fictional user',email:'fake@example.test',rol:'encargado' as const,activo:true,sectores:['Test'],creadoAt:'2026-10-01' };
describe('user action confirmation', () => {
  it('opening, cancellation and empty confirmation never execute a mutation', async () => {
    const execute=vi.fn(async()=>true); const c=crearConfirmacionUsuario(execute);
    c.pedir({tipo:'desactivar',usuario}); expect(c.estado().accion?.usuario.id).toBe(usuario.id);
    c.cancelar(); await c.confirmar(); expect(execute).not.toHaveBeenCalled();
  });
  it.each(['desactivar','reiniciar'] as const)('executes only the identified %s action after explicit confirmation', async tipo => {
    const execute=vi.fn(async()=>true); const c=crearConfirmacionUsuario(execute); const action={tipo,usuario};
    c.pedir(action); expect(execute).not.toHaveBeenCalled(); await c.confirmar();
    expect(execute).toHaveBeenCalledExactlyOnceWith(action); expect(c.estado()).toEqual({accion:null,ocupado:false,fallo:false});
  });
  it('blocks duplicate execution, cancellation and replacement while pending', async () => {
    let resolve!: (ok:boolean)=>void; const execute=vi.fn(()=>new Promise<boolean>(r=>{resolve=r;})); const c=crearConfirmacionUsuario(execute);
    c.pedir({tipo:'desactivar',usuario}); const pending=c.confirmar(); await c.confirmar(); c.cancelar(); c.pedir({tipo:'reiniciar',usuario});
    expect(c.estado()).toMatchObject({ocupado:true,accion:{tipo:'desactivar'}}); expect(execute).toHaveBeenCalledTimes(1);
    resolve(true); await pending; expect(c.estado().accion).toBeNull();
  });
  it('retains the identified action after failure for cancellation or retry', async () => {
    const execute=vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true); const c=crearConfirmacionUsuario(execute);
    c.pedir({tipo:'reiniciar',usuario}); await c.confirmar(); expect(c.estado()).toMatchObject({ocupado:false,accion:{tipo:'reiniciar'}});
    await c.confirmar(); expect(execute).toHaveBeenCalledTimes(2); expect(c.estado().accion).toBeNull();
  });
  it('contains thrown failures and clears their state when a new confirmation is opened', async () => {
    const c=crearConfirmacionUsuario(async()=>{throw new Error('Unavailable');});
    c.pedir({tipo:'desactivar',usuario}); await c.confirmar(); expect(c.estado().fallo).toBe(true);
    c.cancelar(); c.pedir({tipo:'reiniciar',usuario}); expect(c.estado().fallo).toBe(false);
  });
});
