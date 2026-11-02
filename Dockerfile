# Uma única imagem para API e worker: muda apenas o comando de inicialização.

# ---------- base ----------
FROM node:24-alpine AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# ---------- dev ----------
# Usado pelo docker-compose.yml: o código e o node_modules vêm do bind mount.
FROM base AS dev
USER node

# ---------- build ----------
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---------- prod ----------
FROM base AS prod
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/api/server.js"]
