FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/config /app/state && chown -R node:node /app
USER node
CMD ["node", "dist/index.js"]

FROM runtime AS integration
COPY test/docker-integration.mjs /app/test/docker-integration.mjs
CMD ["node", "/app/test/docker-integration.mjs"]

FROM runtime AS production
