import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    // The domain layer is pure: no DOM, no I/O, no globals.
    environment: 'node',
    coverage: {
      include: ['src/domain/**/*.ts'],
      exclude: ['src/domain/**/*.test.ts'],
    },
  },
});
