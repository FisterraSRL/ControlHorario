/**
 * `npm run crear-usuario` — the only way an operator account comes into existence.
 *
 * There is no sign-up page and there will not be one. The people who use this are three or
 * four employees of one company; an account is created by whoever administers the server,
 * on the server, over SSH or at the machine.
 *
 * THE PASSWORD NEVER COMES FROM A COMMAND-LINE ARGUMENT. Not with a flag, not positionally,
 * not "just this once". An argument is written into `~/.bash_history` the moment the shell
 * returns, it is visible in `ps aux` and `/proc/<pid>/cmdline` to every other user on the
 * machine while the command runs, and on Windows it lands in the PowerShell transcript and
 * in `Get-History`. So there are exactly two sources:
 *
 *   1. an interactive prompt with the echo turned off (the normal path);
 *   2. the `CH_CONTRASENA` environment variable, for a scripted first install.
 *
 * The environment is not perfect either — it is readable by the process's own children and,
 * on Linux, by root through `/proc/<pid>/environ` — but it is not persisted anywhere by
 * default, which is the property `argv` lacks.
 *
 * Usage:
 *   npm run build:api
 *   npm run crear-usuario -- --email ana@fisterra.com.ar --nombre "Ana Pérez"
 *   npm run crear-usuario -- --email ana@fisterra.com.ar --reiniciar-contrasena
 *
 * Both `--email` and `--nombre` may be omitted and will be asked for. Neither is secret.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { leerConfiguracion, ErrorConfiguracion } from './config.js';
import { hashearContrasena, validarContrasena, ErrorContrasena } from './contrasenas.js';
import { auditar } from './auditoria.js';
import { crearPool } from './db.js';

interface Argumentos {
  readonly email?: string;
  readonly nombre?: string;
  readonly reiniciar: boolean;
}

/**
 * A deliberately small parser: `--clave valor`, and one boolean flag.
 *
 * It rejects `--contrasena` explicitly instead of ignoring it. Somebody will try it, and a
 * silent "unknown flag" would leave them believing the password they just wrote into their
 * shell history was consumed rather than dropped.
 */
function leerArgumentos(argv: readonly string[]): Argumentos {
  let email: string | undefined;
  let nombre: string | undefined;
  let reiniciar = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--reiniciar-contrasena') {
      reiniciar = true;
      continue;
    }
    if (arg === '--email') {
      email = argv[++i];
      continue;
    }
    if (arg === '--nombre') {
      nombre = argv[++i];
      continue;
    }
    if (arg === '--contrasena' || arg === '--password' || arg?.startsWith('--contrasena=')) {
      throw new Error(
        'La contraseña no se pasa por la línea de comandos: queda en el historial del shell y ' +
          'en la lista de procesos. Corré el comando sin ese argumento y te la va a pedir, o ' +
          'definí CH_CONTRASENA en el entorno.',
      );
    }
    if (arg !== undefined && arg.startsWith('--')) {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }

  return {
    ...(email !== undefined ? { email } : {}),
    ...(nombre !== undefined ? { nombre } : {}),
    reiniciar,
  };
}

/**
 * Reads a line with the echo off.
 *
 * Raw mode and a hand-rolled loop rather than the usual trick of overwriting readline's
 * private `_writeToOutput`: this depends on nothing undocumented, and the three control
 * characters that matter — Enter, Backspace and Ctrl-C — are handled where you can see them.
 * Raw mode also disables the terminal's own Ctrl-C handling, so without that last branch the
 * command would be unkillable at the password prompt.
 */
function preguntarOculto(pregunta: string): Promise<string> {
  return new Promise<string>((resolver, rechazar) => {
    if (!stdin.isTTY) {
      rechazar(
        new Error(
          'No hay una terminal interactiva para pedir la contraseña. Definí CH_CONTRASENA en ' +
            'el entorno y volvé a correr el comando.',
        ),
      );
      return;
    }
    stdout.write(pregunta);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let escrito = '';
    const limpiar = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', alRecibir);
    };

    function alRecibir(trozo: string): void {
      for (const caracter of trozo) {
        if (caracter === '\r' || caracter === '\n' || caracter === '\u0004') {
          limpiar();
          stdout.write('\n');
          resolver(escrito);
          return;
        }
        if (caracter === '\u0003') {
          limpiar();
          stdout.write('\n');
          rechazar(new Error('Cancelado.'));
          return;
        }
        if (caracter === '\u007f' || caracter === '\b') {
          escrito = escrito.slice(0, -1);
          continue;
        }
        // Control characters are dropped rather than stored: an arrow key is three bytes and
        // none of them belong in a password.
        if (caracter < ' ') continue;
        escrito += caracter;
      }
    }

    stdin.on('data', alRecibir);
  });
}

async function preguntar(pregunta: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(pregunta)).trim();
  } finally {
    rl.close();
  }
}

/**
 * The password, from the environment or from the terminal — and from nowhere else.
 *
 * When it is typed it is asked for twice: this creates the account somebody will log in
 * with tomorrow, on a machine they may not be sitting at, and a typo means an account
 * nobody can enter and a script that has to be run again.
 */
async function obtenerContrasena(): Promise<string> {
  const delEntorno = process.env['CH_CONTRASENA'];
  if (delEntorno !== undefined && delEntorno !== '') {
    validarContrasena(delEntorno);
    return delEntorno;
  }
  const primera = await preguntarOculto('Contraseña (no se muestra): ');
  validarContrasena(primera);
  const segunda = await preguntarOculto('Repetila: ');
  if (primera !== segunda) throw new Error('Las dos contraseñas no coinciden. No se creó nada.');
  return primera;
}

async function main(): Promise<void> {
  const args = leerArgumentos(process.argv.slice(2));
  const config = leerConfiguracion();
  const pool = crearPool(config);

  try {
    const email = (args.email ?? (await preguntar('Correo: '))).trim().toLowerCase();
    if (!email.includes('@') || email.startsWith('@')) {
      throw new Error(`"${email}" no parece un correo.`);
    }

    const { rows: existentes } = await pool.query<{ id: number; nombre: string }>(
      'SELECT id, nombre FROM usuarios WHERE email = $1',
      [email],
    );
    const existente = existentes[0];

    if (existente && !args.reiniciar) {
      throw new Error(
        `Ya existe un usuario con ese correo. Si querés cambiarle la contraseña, volvé a ` +
          `correr el comando con --reiniciar-contrasena.`,
      );
    }

    const nombre = existente
      ? existente.nombre
      : (args.nombre ?? (await preguntar('Nombre y apellido: '))).trim();
    if (nombre === '') throw new Error('El nombre no puede estar vacío.');

    const hash = await hashearContrasena(await obtenerContrasena());

    if (existente) {
      await pool.query(
        'UPDATE usuarios SET hash_contrasena = $2, activo = TRUE, actualizado_at = now() WHERE id = $1',
        [existente.id, hash],
      );
      // The audit row carries the id, never the hash and never the password.
      await auditar(pool, {
        actor: config.operador,
        accion: 'usuario_creado',
        entidad: 'usuarios',
        entidadId: String(existente.id),
        datos: { reinicio: true },
      });
      stdout.write(`\nContraseña actualizada para ${email}.\n\n`);
      return;
    }

    const { rows } = await pool.query<{ id: number }>(
      'INSERT INTO usuarios (email, nombre, hash_contrasena) VALUES ($1, $2, $3) RETURNING id',
      [email, nombre, hash],
    );
    const id = rows[0]?.id;
    await auditar(pool, {
      actor: config.operador,
      accion: 'usuario_creado',
      entidad: 'usuarios',
      entidadId: id === undefined ? null : String(id),
      datos: { reinicio: false },
    });
    stdout.write(`\nUsuario creado: ${email}. Ya puede entrar desde la pantalla de acceso.\n\n`);
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  if (e instanceof ErrorConfiguracion) {
    stdout.write(`\nConfiguración inválida: ${e.message}\n\n`);
  } else if (e instanceof ErrorContrasena) {
    stdout.write(`\n${e.message}\n\n`);
  } else if (e instanceof Error && 'code' in e && e.code === '42P01') {
    stdout.write(
      '\nLa base de datos no tiene el esquema aplicado todavía. Corré "npm run db:migrate" ' +
        'primero (docs/servidor.md, sección 5).\n\n',
    );
  } else {
    stdout.write(`\nNo se pudo crear el usuario: ${e instanceof Error ? e.message : String(e)}\n\n`);
  }
  process.exit(1);
});
