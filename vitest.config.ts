import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    // These four suites exercised the retired PostgreSQL/PGlite adapter. Azure SQL
    // integration is verified with `npm run build:api && npm run db:verify`, which runs
    // the real T-SQL in one transaction and rolls it back.
    exclude: [
      'src/api/acceso.test.ts',
      'src/api/decisiones.test.ts',
      'src/api/esquema.test.ts',
      'src/api/origenCruzado.test.ts',
    ],
    // The domain layer is pure: no DOM, no I/O, no globals.
    environment: 'node',
    coverage: {
      include: ['src/domain/**/*.ts'],
      exclude: ['src/domain/**/*.test.ts'],
    },
  },
});
