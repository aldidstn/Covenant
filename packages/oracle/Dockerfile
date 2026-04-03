# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests first for layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/oracle/package.json ./packages/oracle/

# Install only oracle production + dev dependencies
RUN pnpm install --filter @covenant/oracle --frozen-lockfile

# Copy oracle source and build
COPY packages/oracle ./packages/oracle
RUN pnpm --filter @covenant/oracle build

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Install pnpm for production install
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/oracle/package.json ./packages/oracle/

# Production dependencies only
RUN pnpm install --filter @covenant/oracle --frozen-lockfile --prod

# Copy compiled output from builder
COPY --from=builder /app/packages/oracle/dist ./packages/oracle/dist

WORKDIR /app/packages/oracle

# State file persisted here — mount a volume so it survives container restarts:
#   docker run -v covenant-oracle-data:/app/packages/oracle/data ...
VOLUME ["/app/packages/oracle/data"]

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
