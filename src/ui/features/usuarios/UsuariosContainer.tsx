import { useCallback, useEffect, useMemo, useState } from 'react';

import { useConfiguracion } from '../../configuracion/ConfiguracionProvider.js';
import { useHistorial } from '../../historial/HistorialProvider.js';
import { ErrorNoAutenticado } from '../../http.js';
import { useSesion } from '../../sesion/SesionProvider.js';
import type { UsuarioAdministrado } from '../../usuarios/RepositorioUsuarios.js';
import { UsuariosScreen } from './UsuariosScreen.js';
import { sectoresAsignables } from './usuarios.js';

export function UsuariosContainer() {
  const { repositorios, expirar, sesion } = useSesion();
  // The sector list an encargado can be scoped to is not an administration table of its
  // own: it is the evidence plus the rules Configuración already keeps, joined the same way
  // that screen joins them.
  const { sectores: sectoresDelHistorial } = useHistorial();
  const { configuracion } = useConfiguracion();
  const repo = repositorios.usuarios;
  const [usuarios, setUsuarios] = useState<readonly UsuarioAdministrado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [temporal, setTemporal] = useState<string | null>(null);

  const ejecutar = useCallback(async (accion: () => Promise<void>) => {
    setError(null);
    try { await accion(); }
    catch (e: unknown) {
      if (e instanceof ErrorNoAutenticado) { expirar(); return; }
      setError(e instanceof Error ? e.message : 'No se pudo completar la operación.');
    }
  }, [expirar]);

  const recargar = useCallback(async () => {
    if (!repo) return;
    setUsuarios(await repo.listar());
  }, [repo]);

  useEffect(() => {
    void ejecutar(recargar).finally(() => setCargando(false));
  }, [ejecutar, recargar]);

  const sectoresDisponibles = useMemo(
    () => sectoresAsignables(configuracion?.reglasSector ?? {}, sectoresDelHistorial),
    [configuracion, sectoresDelHistorial],
  );

  return <UsuariosScreen usuarios={usuarios} cargando={cargando} error={error}
    usuarioActual={sesion?.operador.email ?? ''} contrasenaTemporal={temporal}
    sectoresDisponibles={sectoresDisponibles}
    onCerrarContrasena={() => setTemporal(null)}
    onCrear={(datos) => void ejecutar(async () => { const r = await repo!.crear(datos); setTemporal(r.contrasenaTemporal); await recargar(); })}
    onEstado={(id, activo) => void ejecutar(async () => { await repo!.cambiarEstado(id, activo); await recargar(); })}
    onReiniciar={(id) => void ejecutar(async () => { const r = await repo!.reiniciarContrasena(id); setTemporal(r.contrasenaTemporal); })}
  />;
}
