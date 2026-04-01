# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests first for layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/oracle/package.json ./packages/oracle/

# Install only oracle production + dev dependencies
RUN pnpm install --filter @vaultlayer/oracle --frozen-lockfile

# Copy oracle source and build
COPY packages/oracle ./packages/oracle
RUN pnpm --filter @vaultlayer/oracle build

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Install pnpm for production install
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/oracle/package.json ./packages/oracle/

# Production dependencies only
RUN pnpm install --filter @vaultlayer/oracle --frozen-lockfile --prod

# Copy compiled output from builder
COPY --from=builder /app/packages/oracle/dist ./packages/oracle/dist

WORKDIR /app/packages/oracle

# Required env vars (override at runtime via --env-file or -e flags)
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
