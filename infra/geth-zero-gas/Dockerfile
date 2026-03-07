# ==============================================================================
# ClawNet — Patched geth v1.13.15 with zero-gas support
# ==============================================================================
# Geth v1.13.15 sanitizes --miner.gasprice=0 to 1 Gwei (hardcoded floor).
# This Dockerfile patches the sanitization to allow gasPrice=0, enabling
# true zero-gas operation for PoA chains.
#
# Build:
#   docker build -t clawnet/geth:v1.13.15-zero-gas .
#
# The resulting image is a drop-in replacement for ethereum/client-go:v1.13.15
# ==============================================================================

FROM golang:1.21-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    git make gcc libc-dev \
    && rm -rf /var/lib/apt/lists/*

# Clone exact geth v1.13.15 source
RUN git clone --depth 1 --branch v1.13.15 \
    https://github.com/ethereum/go-ethereum.git /go-ethereum

WORKDIR /go-ethereum

# Patch 1: Allow miner.gasprice = 0
#   Before: rejects gasPrice <= 0 → forces to 1 Gwei
#   After:  rejects gasPrice < 0  → allows 0
RUN sed -i 's/conf\.Miner\.GasPrice\.Cmp(common\.Big0) <= 0/conf.Miner.GasPrice.Cmp(common.Big0) < 0/' \
    eth/ethconfig/config.go

# Patch 2: Allow gpo.maxprice = 0
#   Before: rejects maxPrice <= 0 → forces to 500 Gwei
#   After:  rejects maxPrice < 0  → allows 0
RUN sed -i 's/conf\.GPO\.MaxPrice\.Cmp(common\.Big0) <= 0/conf.GPO.MaxPrice.Cmp(common.Big0) < 0/' \
    eth/ethconfig/config.go

# Patch 3: Allow gpo.ignoreprice = 0
#   Before: rejects ignorePrice <= 0 → forces to 2
#   After:  rejects ignorePrice < 0  → allows 0
RUN sed -i 's/conf\.GPO\.IgnorePrice\.Int64() <= 0/conf.GPO.IgnorePrice.Int64() < 0/' \
    eth/ethconfig/config.go

# Verify patches applied (fail build if not)
RUN grep -q 'Cmp(common.Big0) < 0' eth/ethconfig/config.go \
    && echo "✓ Patches applied successfully" \
    || (echo "ERROR: Patches failed to apply" && exit 1)

# Build geth
RUN make geth

# ==============================================================================
# Runtime image (minimal)
# ==============================================================================
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /go-ethereum/build/bin/geth /usr/local/bin/geth

EXPOSE 8545 8546 30303 30303/udp

ENTRYPOINT ["geth"]
