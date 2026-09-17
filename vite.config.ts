import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Build config.
 *
 * `outDir` is `dist/`, and TWO deployments now read it:
 *
 *   * Vercel, which serves it as the production frontend — `outputDirectory` in
 *     `vercel.json` says `dist` and has to keep saying whatever this says;
 *   * the `api` container of the local stack, which copies it out of the build stage
 *     (Dockerfile, `COPY --from=build /app/dist`) and serves it itself.
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
     * A proxy, so that `npm run dev` stays a same-origin `/api/...` call and needs no
     * `APP_ORIGEN_FRONTEND` entry on the server. The API does now carry a CORS allow-list —
     * the production frontend is on Vercel and there is no way around it — and this proxy
     * is what keeps that list at exactly ONE entry: the production origin. A second entry
     * added "just for development" is the first step of a list that eventually has a `*`
     * in it, and the whole security of `SameSite=None` rests on that list being one origin
     * long (src/api/cors.ts).
     *
     * Only used when the dev build is pointed at an API: set VITE_API_BASE_URL=/api in a
     * local `.env`. With no variable set, `npm run dev` uses localStorage and never
     * reaches this.
     *
     * To develop against the REAL Azure API instead, point the proxy `target` at it — not
     * `VITE_API_BASE_URL`, which would make the browser call it directly and fail CORS.
     */
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
});
