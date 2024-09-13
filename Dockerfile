# syntax=docker/dockerfile:1
FROM node:20-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
COPY ./packages packages

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store cd packages && pnpm install --prod --frozen-lockfile && pnpm rebuild

FROM base AS build
RUN apt-get update && apt-get install -y make
RUN --mount=type=cache,id=pnpm,target=/pnpm/store cd packages && pnpm install --frozen-lockfile && pnpm rebuild
RUN cd packages && make build

FROM base AS main
COPY --from=prod-deps /app/packages/node_modules /app/packages/node_modules
COPY --from=prod-deps /app/packages/apps/web-ui/node_modules /app/packages/apps/web-ui/node_modules
COPY --from=prod-deps /app/packages/apps/personal-node/node_modules /app/packages/apps/personal-node/node_modules
COPY --from=prod-deps /app/packages/packages/core/node_modules /app/packages/packages/core/node_modules
COPY --from=build /app/packages/apps/web-ui/dist /app/packages/apps/web-ui/dist
COPY --from=build /app/packages/apps/personal-node/dist /app/packages/apps/personal-node/dist
COPY --from=build /app/packages/packages/core/dist /app/packages/packages/core/dist

VOLUME [ "/app/data" ]
EXPOSE 3000

ENV PORT="3000"
ENV DATA_DIR="/app/data"

WORKDIR /app/packages/apps/personal-node
CMD [ "node", "." ]
