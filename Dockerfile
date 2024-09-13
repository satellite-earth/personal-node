# syntax=docker/dockerfile:1
FROM node:20-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /packages
COPY ./packages /packages/

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM base AS build
RUN apt-get update && apt-get install -y make
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN make install build

FROM base AS main
COPY --from=prod-deps /packages/node_modules /packages/node_modules
COPY --from=prod-deps /packages/apps/web-ui/node_modules /packages/apps/web-ui/node_modules
COPY --from=prod-deps /packages/apps/personal-node/node_modules /packages/apps/personal-node/node_modules
COPY --from=prod-deps /packages/packages/core/node_modules /packages/packages/core/node_modules
COPY --from=build /packages/apps/web-ui/dist /packages/apps/web-ui/dist
COPY --from=build /packages/apps/personal-node/dist /packages/apps/personal-node/dist
COPY --from=build /packages/packages/core/dist /packages/packages/core/dist

VOLUME [ "/app/data" ]
EXPOSE 3000

ENV PORT="3000"
ENV DATA_DIR="/app/data"

WORKDIR /packages/apps/personal-node
CMD [ "node", "." ]
