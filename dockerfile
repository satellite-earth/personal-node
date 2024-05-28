# syntax=docker/dockerfile:1
FROM node:20.11 as builder
ARG NODE_AUTH_TOKEN

WORKDIR /app
ENV NODE_ENV=development
COPY ./package*.json .
COPY ./yarn.lock .
COPY . .
# set the auth token in the .npmrc file
RUN sed -i '1i //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}' .npmrc
RUN yarn install
RUN yarn build

FROM node:20.11-alpine
ARG NODE_AUTH_TOKEN

WORKDIR /app
ENV NODE_ENV=production
COPY ./package*.json .
COPY ./yarn.lock .
COPY . .
# set the auth token in the .npmrc file
RUN sed -i '1i //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}' .npmrc
RUN yarn install
COPY --from=builder ./app/dist ./dist

VOLUME [ "/app/data" ]
EXPOSE 3000

ENV PORT="3000"

ENTRYPOINT [ "node", "." ]
