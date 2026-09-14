import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Build config for the Static Web Apps deployment.
 *
 * `outDir` is `dist/`, which is what `output_location` in
 * `.github/workflows/azure-static-web-apps-*.yml` points at. Changing one without the
 * other deploys an empty site.
 *
 * The test runner keeps its own config in `vitest.config.ts`: the domain suite runs in a
 * bare node environment with no React, no DOM and no plugin pipeline, and it must stay
 * that way.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // The QUICKPASS reader is the only large dependency. Warn late enough that it is not
    // noise on every build, early enough that a second heavy import is noticed.
    chunkSizeWarningLimit: 900,
  },
});
