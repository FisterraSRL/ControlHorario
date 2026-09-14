import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Build config.
 *
 * `outDir` is `dist/`, which is what the `api` container copies out of the build stage and
 * serves (Dockerfile, `COPY --from=build /app/dist`). Changing one without the other ships
 * an image with no frontend in it.
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
  server: {
    /**
     * `npm run dev` on :5173 talking to a local `npm run api` on :8080.
     *
     * A proxy rather than CORS on the server: with the proxy, dev and production are the
     * same same-origin relative `/api/...` call, so the one configuration that only exists
     * in development is this block. Adding CORS instead would mean the server permanently
     * carries an allowed-origins list for the sake of a dev convenience — and an
     * allowed-origins list is a thing that eventually gets a `*` in it.
     *
     * Only used when the dev build is pointed at an API: set VITE_API_BASE_URL=/api in a
     * local `.env`. With no variable set, `npm run dev` uses localStorage and never
     * reaches this.
     */
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
});
