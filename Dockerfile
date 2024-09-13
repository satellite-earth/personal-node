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
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN make install build

FROM base
COPY --from=prod-deps /packages/node_modules /packages/node_modules
COPY --from=build /app/dist /app/dist

VOLUME [ "/app/data" ]
EXPOSE 3000

ENV PORT="3000"

CMD [ "node", "." ]
