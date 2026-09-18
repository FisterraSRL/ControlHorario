/**
 * The Usuarios alta form, as data. Pure: no React, no repository.
 *
 * WHAT IS CHECKED HERE IS A COPY OF WHAT THE SERVER CHECKS, and that is deliberate. The
 * pairing — an encargado has at least one sector, nobody else has any — is enforced inside
 * the transaction that writes the account (see the header of src/api/rutasUsuarios.ts), and
 * that is the copy that decides. This one exists so the form can say what is missing before
 * the request rather than after it, and so it can be tested without a browser.
 *
 * THE SECTOR LIST IS NOT FREE TEXT. A sector is the `Sector` cell of the QUICKPASS export,
 * matched exactly by `JSON_VALUE([payload], '$.Sector')` in every scoped query, so a typo'd
 * sector is not a small mistake: the account is created, the login works, and the person
 * sees an empty app with nothing to indicate why. So the options are the union `filasDeSector`
 * already derives for Configuración, and when that union is empty the form refuses to submit
 * instead of offering a text field.
 */

import type { RolUsuario } from '../../roles.js';
import { filasDeSector } from '../configuracion/configuracion.js';

export interface BorradorUsuario {
  readonly nombre: string;
  readonly email: string;
  readonly rol: RolUsuario;
  /** What is ticked in the picker. Meaningless unless `rol` is `encargado`. */
  readonly sectores: readonly string[];
}

/**
 * Every sector an encargado could be scoped to: the ones seen in the historial plus the
 * ones that already have a rule in Configuración.
 *
 * It delegates to `filasDeSector` rather than repeating the union, because "which sectors
 * exist" has to mean the same thing on both screens — a sector Configuración lists and this
 * one does not would be a sector nobody can be made responsible for.
 */
export function sectoresAsignables(
  reglas: Readonly<Record<string, number>>,
  sectoresDelHistorial: readonly string[],
): readonly string[] {
  return filasDeSector(reglas, sectoresDelHistorial).map((fila) => fila.sector);
}

/** What actually travels in the request: sectors only ever belong to an encargado. */
export function sectoresParaCrear(
  rol: RolUsuario,
  seleccionados: readonly string[],
): readonly string[] {
  return rol === 'encargado' ? [...new Set(seleccionados)] : [];
}

/**
 * The reason «Crear usuario» is blocked, or `null` when the draft may be sent.
 *
 * One function and one message, so the disabled button and the explanation under it cannot
 * disagree about why.
 */
export function problemaDelAlta(
  borrador: BorradorUsuario,
  sectoresDisponibles: readonly string[],
): string | null {
  if (borrador.nombre.trim() === '' || !borrador.email.includes('@')) {
    return 'Completá un nombre y un correo válido.';
  }

  const sectores = sectoresParaCrear(borrador.rol, borrador.sectores);

  if (borrador.rol === 'encargado') {
    if (sectoresDisponibles.length === 0) {
      return 'Todavía no hay sectores cargados, así que no hay ninguno para asignar. Cargá una planilla y volvé a intentar.';
    }
    if (sectores.length === 0) {
      return 'Un encargado tiene que supervisar al menos un sector.';
    }
    // A sector that is not on the list would be scoping somebody to nothing. It cannot be
    // typed in the form, but it can survive a role change after ticking boxes.
    const desconocido = sectores.find((s) => !sectoresDisponibles.includes(s));
    if (desconocido !== undefined) {
      return `El sector «${desconocido}» ya no figura en los datos cargados.`;
    }
  }

  return null;
}
