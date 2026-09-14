import { PlaceholderScreen } from '../../app/PlaceholderScreen.js';

/**
 * PLACEHOLDER. See `src/ui/app/PlaceholderScreen.tsx`.
 *
 * The values this screen will edit already exist and are already in use — see
 * `configuracion.ts` next to this file. Today they are constants.
 */
export function ConfiguracionScreen() {
  return (
    <PlaceholderScreen
      titulo="Configuración"
      descripcion="Reglas de fichadas por sector, parámetros de descanso y tolerancia, personas excluidas de notificaciones y maestro de motivos de ausencia."
      slice="slice 2b"
    />
  );
}
