/**
 * The disciplinary notification generator. Pure functions over plain data: no DOM, no I/O,
 * no globals, no `window`, no `document`. It takes a person's faltas and returns the bytes
 * of a `.docx`; who downloads them, and how, is somebody else's job.
 *
 * Extracted from the WORD GENERATION section of `legacy/app.html` (~lines 1853-2125). The
 * two functions from that section that are NOT here — `offerDownload` and
 * `fallbackDownload` — touch the DOM and belong to the UI layer.
 *
 * Start at `generarWord` / `generarWordMasivo`; everything else is what they are made of.
 */

export * from './tipos.js';
export * from './fechas.js';
export * from './densidad.js';
export * from './ooxml.js';
export * from './tablaDeFaltas.js';
export * from './apercibimiento.js';
export * from './documentoWord.js';
