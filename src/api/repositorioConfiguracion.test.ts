import { describe, expect, it } from 'vitest';

import { crearPoolFalso } from './pruebas/dobles.js';
import { crearRepositorioConfiguracion } from './repositorioConfiguracion.js';

describe('Creating an absence reason', () => {
  it('reactivates a retired reason with its original identity and selected worked flag', async () => {
    const pool = crearPoolFalso((sql) => {
      if (sql.includes('AS [siguiente]')) return { rows: [{ siguiente: 12 }] };
      if (sql.includes('OUTPUT inserted.') && sql.includes('UPDATE')) {
        return { rows: [{ id: 10, label: 'Trámite', worked: false }] };
      }
      if (sql.includes('INSERT INTO [controlhorario].[motivos]')) {
        return new Error('The retired label still owns its unique key');
      }
      return undefined;
    });

    await expect(crearRepositorioConfiguracion(pool).crearMotivo(' Trámite ', false, 'admin'))
      .resolves.toEqual({ id: 10, label: 'Trámite', worked: false });

    const update = pool.llamadas.find((call) => call.texto.includes('OUTPUT inserted.'));
    expect(update?.texto).toContain('[activo] = 0');
    expect(update?.texto).toContain('SET [activo] = 1, [worked] = $2');
    expect(update?.valores).toEqual(['Trámite', false]);
    expect(pool.textos().join('\n')).not.toContain('INSERT INTO [controlhorario].[motivos]');
    expect(pool.llamadas.at(-1)?.valores).toContain('motivo_reactivado');
    expect(pool.llamadas.at(-1)?.valores).toContain('10');
    expect(pool.llamadas.every((call) => call.enTransaccion)).toBe(true);
    expect(pool.cierres).toEqual(['commit']);
  });

  it('allocates a new identity only when no retired label matches', async () => {
    const pool = crearPoolFalso((sql) => {
      if (sql.includes('AS [siguiente]')) return { rows: [{ siguiente: 12 }] };
      if (sql.includes('INSERT INTO [controlhorario].[motivos]')) {
        return { rows: [{ id: 12, label: 'Nuevo', worked: true }] };
      }
      return undefined;
    });
    await expect(crearRepositorioConfiguracion(pool).crearMotivo(' Nuevo ', true, 'admin'))
      .resolves.toEqual({ id: 12, label: 'Nuevo', worked: true });
    expect(pool.llamadas.find((call) => call.texto.includes('INSERT INTO [controlhorario].[motivos]'))?.valores)
      .toEqual([12, 'Nuevo', true]);
    expect(pool.llamadas.at(-1)?.valores).toContain('motivo_creado');
    expect(pool.cierres).toEqual(['commit']);
  });

  it('preserves the active duplicate conflict without auditing or committing', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { number: 2627 });
    const pool = crearPoolFalso((sql) => {
      if (sql.includes('AS [siguiente]')) return { rows: [{ siguiente: 12 }] };
      if (sql.includes('INSERT INTO [controlhorario].[motivos]')) return duplicate;
      return undefined;
    });
    await expect(crearRepositorioConfiguracion(pool).crearMotivo('Activo', false, 'admin'))
      .rejects.toBe(duplicate);
    expect(pool.textos().join('\n')).not.toContain('[controlhorario].[auditoria]');
    expect(pool.cierres).toEqual(['rollback']);
  });

  it('rolls back reactivation when its audit cannot be written', async () => {
    const pool = crearPoolFalso((sql) => {
      if (sql.includes('AS [siguiente]')) return { rows: [{ siguiente: 12 }] };
      if (sql.includes('OUTPUT inserted.') && sql.includes('UPDATE')) {
        return { rows: [{ id: 10, label: 'Trámite', worked: true }] };
      }
      if (sql.includes('[controlhorario].[auditoria]')) return new Error('audit unavailable');
      return undefined;
    });
    await expect(crearRepositorioConfiguracion(pool).crearMotivo('Trámite', true, 'admin'))
      .rejects.toThrow('audit unavailable');
    expect(pool.cierres).toEqual(['rollback']);
  });
});
