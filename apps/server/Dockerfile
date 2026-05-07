# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM deps AS dev
COPY apps/server apps/server
COPY packages/shared packages/shared
COPY tsconfig.base.json ./
EXPOSE 3000
CMD ["pnpm", "--filter", "server", "start:dev"]

FROM deps AS build
COPY apps/server apps/server
COPY packages/shared packages/shared
COPY tsconfig.base.json ./
RUN pnpm --filter server build

FROM base AS prod
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/package.json apps/server/
COPY --from=build /app/node_modules node_modules
WORKDIR /app/apps/server
EXPOSE 3000
CMD ["node", "dist/main.js"]
