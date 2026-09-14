# =============================================================================
# ControlHorario — imagen del servicio `api`.
#
# Una sola imagen sirve las dos cosas: la API REST y el bundle de React. Son el mismo
# origen a propósito — el frontend llama a `/api/...` relativo, así que no hay CORS que
# configurar y el túnel de adelante (Tailscale hoy, Cloudflare el día que haya dominio)
# es invisible para la aplicación.
# =============================================================================

# Fijada exacta. `node:24` se mueve solo y una build que ayer andaba deja de andar sin que
# haya cambiado una línea del repositorio.
FROM node:24.21.0-alpine3.24 AS build

WORKDIR /app

# package.json + lock primero: mientras las dependencias no cambien, Docker reusa esta capa
# y `npm ci` no se vuelve a ejecutar aunque cambie todo el código.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.api.json vite.config.ts index.html ./
COPY src ./src

# Vite sustituye las VITE_* EN TIEMPO DE COMPILACIÓN: no las puede leer al arrancar. Por eso
# esto es un build arg y no una variable del contenedor. `/api` relativo significa "el mismo
# origen que sirvió la página", que es lo que hace que cambiar de túnel no toque el bundle.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

# El frontend (tsc -b + vite build -> dist/) y la API (tsc -p tsconfig.api.json -> dist-api/).
RUN npm run build && npm run build:api

# Las dependencias de producción, resueltas contra el mismo lock.
RUN npm ci --omit=dev

# -----------------------------------------------------------------------------
FROM node:24.21.0-alpine3.24 AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-api ./dist-api
COPY package.json ./
# El runner de migraciones lee estos archivos del disco en cada arranque, así que van
# adentro de la imagen: la versión del esquema y la del código viajan juntas y no puede
# pasar que el contenedor aplique una migración que no es la de su propio código.
COPY db/migrations ./db/migrations

# La imagen de node trae el usuario `node` (uid 1000). Nada acá escribe en el disco.
USER node

EXPOSE 8080

# El healthcheck también está en docker-compose.yml; acá sirve para `docker run` suelto.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist-api/api/main.js"]
