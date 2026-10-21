# Imagen de la API y del worker (mismo código, distinto comando). Contexto: raíz del repo.
FROM node:24-alpine AS build
RUN npm install -g pnpm@11.21.0 && npm cache clean --force
ENV CI=true
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --filter "@reto/backend..."
COPY packages/shared packages/shared
COPY backend backend
RUN pnpm --filter @reto/shared build && pnpm --filter @reto/backend build
# Quita las dependencias de desarrollo antes de copiar node_modules a la imagen final.
RUN pnpm install --frozen-lockfile --prod --filter "@reto/backend..."

FROM node:24-alpine
ENV NODE_ENV=production
# tests/database.test.mjs ejecuta `node` aquí e importa ./dist/db.js y ./dist/passwords.js
WORKDIR /app/backend
COPY --from=build --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist /app/packages/shared/dist
COPY --from=build --chown=node:node /app/packages/shared/node_modules /app/packages/shared/node_modules
COPY --from=build --chown=node:node /app/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/dist ./dist
COPY backend/package.json backend/schema.sql ./
COPY data/manifest.json data/test-users.json data/fidelity.json data/relationships.json /app/data/
USER node
EXPOSE 8000
CMD ["node", "dist/server.js"]
