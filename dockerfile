# syntax=docker/dockerfile:1
FROM node:20-slim AS base
ARG NODE_AUTH_TOKEN

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
COPY . /app
# set the auth token in the .npmrc file
RUN sed -i '1i //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}' .npmrc

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm run build

FROM base
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist

VOLUME [ "/app/data" ]
EXPOSE 3000

ENV PORT="3000"

CMD [ "node", "." ]
