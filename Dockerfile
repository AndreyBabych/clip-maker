FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY lib ./lib
COPY migrations ./migrations
COPY domain.js server.js worker.js ./
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "server.js"]
