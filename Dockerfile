FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./

# Development — devDependencies present for tsx watch hot reload
FROM base AS dev
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["node", "--import=tsx/esm", "--watch", "src/server.ts"]

# Builder — compiles TypeScript
FROM base AS builder
RUN npm ci
COPY . .
RUN npm run build

# Production — lean Alpine image with prod deps only
FROM node:20-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
