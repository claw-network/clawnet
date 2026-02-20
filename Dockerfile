# ============================================================================
# ClawNet Node — Multi-stage Docker build
# ============================================================================
# Build:   docker build -t openclaw/clawnet .
# Run:     docker run -d -p 9528:9528 -v clawnet-data:/data openclaw/clawnet
# ============================================================================

# --- Stage 1: Build ----------------------------------------------------------
FROM node:20-alpine AS build

# Native build tools for classic-level (node-gyp)
RUN apk add --no-cache python3 make g++

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

# Copy tsconfig files for all packages (needed by tsc -b)
COPY packages/core/tsconfig.json packages/core/
COPY packages/protocol/tsconfig.json packages/protocol/
COPY packages/node/tsconfig.json packages/node/
COPY packages/cli/tsconfig.json packages/cli/
COPY packages/sdk/tsconfig.json packages/sdk/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code (only src dirs — .dockerignore excludes dist, node_modules, .tsbuildinfo)
COPY packages/core/src/ packages/core/src/
COPY packages/protocol/src/ packages/protocol/src/
COPY packages/node/src/ packages/node/src/
COPY packages/cli/src/ packages/cli/src/
COPY packages/sdk/src/ packages/sdk/src/

# Build all packages (use root-level tsc -b to handle project references + symlinks correctly)
RUN npx tsc -b tsconfig.json

# --- Stage 2: Runtime --------------------------------------------------------
FROM node:20-alpine

RUN apk add --no-cache tini
RUN npm install -g pnpm@10

WORKDIR /app

# Copy workspace config + package.json files for pnpm install
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-lock.yaml ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/protocol/package.json ./packages/protocol/
COPY --from=build /app/packages/node/package.json ./packages/node/
COPY --from=build /app/packages/cli/package.json ./packages/cli/
COPY --from=build /app/packages/sdk/package.json ./packages/sdk/

# Install production dependencies with pnpm (preserves proper symlink structure)
RUN pnpm install --prod --frozen-lockfile

# Copy built artifacts
COPY --from=build /app/packages/node/dist ./packages/node/dist
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=build /app/packages/cli/dist ./packages/cli/dist

# Copy entrypoint scripts
COPY scripts/entrypoint-peer.sh /usr/local/bin/entrypoint-peer.sh
RUN chmod +x /usr/local/bin/entrypoint-peer.sh

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
  CMD wget -q --spider http://127.0.0.1:9528/api/node/status || exit 1

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "packages/node/dist/daemon.js", \
     "--data-dir", "/data", \
     "--api-host", "0.0.0.0", \
     "--api-port", "9528"]
