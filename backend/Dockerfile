FROM node:24-alpine AS build
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY backend/package.json backend/schema.sql ./
COPY data/manifest.json data/test-users.json data/fidelity.json data/relationships.json ./data/
USER node
EXPOSE 8000
CMD ["node", "dist/server.js"]
