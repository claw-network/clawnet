# ============================================================================
# ClawToken Node — Multi-stage Docker build
# ============================================================================
# Build:   docker build -t openclaw/clawtoken .
# Run:     docker run -d -p 9528:9528 -v clawtoken-data:/data openclaw/clawtoken
# ============================================================================

# --- Stage 1: Build ----------------------------------------------------------
FROM node:20-alpine AS build

RUN npm install -g pnpm@10

WORKDIR /app

# Copy workspace config first (for better layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./

# Copy package.json files for all packages
COPY packages/core/package.json packages/core/
COPY packages/protocol/package.json packages/protocol/
COPY packages/node/package.json packages/node/
COPY packages/cli/package.json packages/cli/
COPY packages/sdk/package.json packages/sdk/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/core/ packages/core/
COPY packages/protocol/ packages/protocol/
COPY packages/node/ packages/node/
COPY packages/cli/ packages/cli/
COPY packages/sdk/ packages/sdk/

# Build all packages
RUN pnpm build

# --- Stage 2: Runtime --------------------------------------------------------
FROM node:20-alpine

RUN apk add --no-cache tini

WORKDIR /app

# Copy built artifacts
COPY --from=build /app/packages/node/dist ./packages/node/dist
COPY --from=build /app/packages/node/package.json ./packages/node/
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=build /app/packages/protocol/package.json ./packages/protocol/
COPY --from=build /app/packages/cli/dist ./packages/cli/dist
COPY --from=build /app/packages/cli/package.json ./packages/cli/

# Copy node_modules (production only)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

# Environment
ENV NODE_ENV=production
ENV CLAW_DATA_DIR=/data
ENV CLAW_API_HOST=0.0.0.0
ENV CLAW_API_PORT=9528

# Expose ports: API + P2P
EXPOSE 9528 9529

# Persistent data volume
VOLUME /data

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:9528/api/node/status || exit 1

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "packages/node/dist/daemon.js", \
     "--data-dir", "/data", \
     "--api-host", "0.0.0.0", \
     "--api-port", "9528"]
