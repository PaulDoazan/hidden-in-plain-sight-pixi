# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/client/package.json apps/client/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM deps AS dev
COPY apps/client apps/client
COPY packages/shared packages/shared
EXPOSE 5173
CMD ["pnpm", "--filter", "client", "dev", "--host"]

FROM deps AS build
COPY apps/client apps/client
COPY packages/shared packages/shared
COPY tsconfig.base.json ./
RUN pnpm --filter client build

FROM nginx:alpine AS prod
COPY --from=build /app/apps/client/dist /usr/share/nginx/html
EXPOSE 80
