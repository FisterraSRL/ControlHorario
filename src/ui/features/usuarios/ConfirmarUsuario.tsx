import { useEffect, useId, useRef } from 'react';
import { Button } from '../../components/atoms/Button/Button.js';
import type { AccionUsuario } from './confirmacionUsuario.js';

export function ConfirmarUsuario({ accion, ocupado, error, esCuentaPropia = false, onCancelar, onConfirmar }: { readonly accion: AccionUsuario; readonly ocupado: boolean; readonly error: string | null; readonly esCuentaPropia?: boolean; readonly onCancelar: () => void; readonly onConfirmar: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const title = useId(); const description = useId();
  useEffect(() => {
    const focused = document.activeElement; const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (focused instanceof HTMLElement && focused.isConnected) focused.focus(); };
  }, []);
  const desactivar = accion.tipo === 'desactivar';
  return <dialog ref={dialog} className="usuarios__confirmacion" aria-labelledby={title} aria-describedby={description} onCancel={e => { e.preventDefault(); if (!ocupado) onCancelar(); }}>
    <h2 id={title}>{desactivar ? 'Desactivar usuario' : 'Restablecer contraseña'}</h2>
    <p><strong>{accion.usuario.nombre}</strong><br/>{accion.usuario.email}</p>
    <p id={description}>{desactivar ? 'Se desactivará esta cuenta y se revocarán sus sesiones. No podrá iniciar sesión hasta que se vuelva a activar.' : `La contraseña actual dejará de funcionar. ${esCuentaPropia ? 'Las sesiones de tu propia cuenta se conservarán.' : 'Se revocarán sus sesiones.'} Se generará una contraseña temporal nueva para compartir por un canal seguro.`}</p>
    {error && <p role="alert">{error}</p>}
    <div className="usuarios__acciones"><Button autoFocus disabled={ocupado} onClick={onCancelar}>Cancelar</Button><Button variante="primary" disabled={ocupado} onClick={onConfirmar}>{ocupado ? 'Procesando…' : desactivar ? 'Confirmar desactivación' : 'Confirmar restablecimiento'}</Button></div>
  </dialog>;
}
