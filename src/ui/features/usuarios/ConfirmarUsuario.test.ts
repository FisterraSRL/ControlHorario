import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConfirmarUsuario } from './ConfirmarUsuario.js';
describe('user confirmation dialog contract', () => {
  const usuario={id:'TEST',nombre:'Fictional person',email:'fictional@example.test',rol:'admin' as const,activo:true,sectores:[],creadoAt:''};
  it.each(['desactivar','reiniciar'] as const)('identifies the user and effects for %s with accessible dialog labels',tipo=>{
    const html=renderToStaticMarkup(createElement(ConfirmarUsuario,{accion:{tipo,usuario},ocupado:false,error:null,onCancelar(){},onConfirmar(){}}));
    expect(html).toContain('<dialog'); expect(html).toContain('aria-labelledby'); expect(html).toContain('aria-describedby'); expect(html).toContain(usuario.email);
    expect(html).toContain('Cancelar'); expect(html).toContain('revocarán sus sesiones');
    expect(html).toContain(tipo==='desactivar'?'Confirmar desactivación':'Confirmar restablecimiento');
  });
  it('disables both actions while processing and exposes failure in the dialog',()=>{
    const html=renderToStaticMarkup(createElement(ConfirmarUsuario,{accion:{tipo:'reiniciar',usuario},ocupado:true,error:'Simulated failure',onCancelar(){},onConfirmar(){}}));
    expect(html.match(/disabled=""/g)).toHaveLength(2); expect(html).toContain('Procesando…'); expect(html).toContain('role="alert"');
  });
  it('describes the existing session-preservation contract when resetting the current account',()=>{
    const html=renderToStaticMarkup(createElement(ConfirmarUsuario,{accion:{tipo:'reiniciar',usuario},ocupado:false,error:null,esCuentaPropia:true,onCancelar(){},onConfirmar(){}}));
    expect(html).toContain('Las sesiones de tu propia cuenta se conservarán.');expect(html).not.toContain('Se revocarán sus sesiones.');
  });
});
