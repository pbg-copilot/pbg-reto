# Build estático servido por nginx. Contexto: raíz del repo.
FROM node:24-alpine AS build
RUN npm install -g pnpm@11.21.0 && npm cache clean --force
ENV CI=true
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --filter "@reto/frontend..."
COPY packages/shared packages/shared
COPY frontend frontend
RUN pnpm --filter @reto/shared build && pnpm --filter @reto/frontend build

FROM nginx:alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
