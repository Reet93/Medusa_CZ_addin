# Build + run the medusa-cz demo backend (pnpm monorepo).
# Build context = repo root; Coolify: Base Directory "/", Dockerfile "/apps/backend/Dockerfile".
FROM node:20-slim

# ca-certs for TLS + toolchain for any native module builds
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Whole workspace (pnpm needs the full graph to resolve workspace:* deps)
COPY . .

# Full install (dev deps needed for the build), then build the packages the
# backend depends on, then the backend (+ admin) itself.
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @medusa-cz/shared build \
 && pnpm --filter @medusa-cz/payment-comgate build \
 && pnpm --filter @medusa-cz/demo build

WORKDIR /app/apps/backend
ENV NODE_ENV=production
EXPOSE 9000

# Migrate then start (medusa start serves the built admin at /app too).
CMD ["sh", "-c", "npx medusa db:migrate && npx medusa start"]
