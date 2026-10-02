FROM node:20-bookworm-slim

# git: source-control panel · tar: project download · openssl: Prisma engines
RUN apt-get update \
 && apt-get install -y --no-install-recommends git tar openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
RUN npx prisma generate

ENV NODE_ENV=production
EXPOSE 5000
# Apply any pending database migrations, then start.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node server.js"]
