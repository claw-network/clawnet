#!/usr/bin/env bash
# Generate locally-trusted TLS certificates using mkcert.
# Idempotent — safe to re-run. Skips if certs already exist.
#
# Usage: bash scripts/telagent/ensure-local-certs.sh
#
# What it does:
#   1. Downloads mkcert binary (if not already present) from install.telagent.org
#   2. Installs the local CA into the system trust store (mkcert -install)
#   3. Generates cert.pem + key.pem for localhost/127.0.0.1/::1
#
# Environment variables:
#   TELAGENT_HOME       — data root (default: ~/.telagent)
#   MKCERT_SKIP         — set to "1" to skip entirely
#   CI                  — set to "true" to skip entirely (CI environments)

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${CYAN}[cert]${RESET}  %s\n" "$*"; }
ok()    { printf "${GREEN}[cert]${RESET}  %s\n" "$*"; }
warn()  { printf "${YELLOW}[cert]${RESET}  %s\n" "$*"; }

# ── Skip conditions ──────────────────────────────────────────────────
if [ "${MKCERT_SKIP:-}" = "1" ]; then
  info "MKCERT_SKIP=1, skipping certificate generation"
  exit 0
fi

if [ "${CI:-}" = "true" ]; then
  info "CI environment detected, skipping certificate generation"
  exit 0
fi

# ── Paths ─────────────────────────────────────────────────────────────
TELAGENT_HOME="${TELAGENT_HOME:-$HOME/.telagent}"
BIN_DIR="${TELAGENT_HOME}/bin"
CERT_DIR="${TELAGENT_HOME}/tls"
MKCERT_BIN="${BIN_DIR}/mkcert"

MKCERT_VERSION="v1.4.4"
DOWNLOAD_BASE="https://install.telagent.org/binaries/mkcert"

# ── Detect OS and architecture ────────────────────────────────────────
detect_platform() {
  local os arch

  case "$(uname -s)" in
    Darwin*)  os="darwin" ;;
    Linux*)   os="linux" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *)        warn "Unsupported OS: $(uname -s)"; return 1 ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64)   arch="amd64" ;;
    arm64|aarch64)   arch="arm64" ;;
    armv7l|armv6l)   arch="arm" ;;
    *)               warn "Unsupported architecture: $(uname -m)"; return 1 ;;
  esac

  if [ "$os" = "windows" ]; then
    echo "mkcert-${MKCERT_VERSION}-${os}-${arch}.exe"
  else
    echo "mkcert-${MKCERT_VERSION}-${os}-${arch}"
  fi
}

# ── Step 1: Ensure mkcert binary is available ─────────────────────────
ensure_mkcert() {
  # Check if mkcert is already in PATH
  if command -v mkcert &>/dev/null; then
    MKCERT_BIN="$(command -v mkcert)"
    ok "mkcert found at ${MKCERT_BIN}"
    return 0
  fi

  # Check if we already downloaded it
  if [ -x "$MKCERT_BIN" ]; then
    ok "mkcert found at ${MKCERT_BIN}"
    return 0
  fi

  info "mkcert not found, downloading..."

  local filename
  filename=$(detect_platform) || return 1

  local url="${DOWNLOAD_BASE}/${filename}"
  mkdir -p "$BIN_DIR"

  if command -v curl &>/dev/null; then
    curl -fsSL "$url" -o "$MKCERT_BIN"
  elif command -v wget &>/dev/null; then
    wget -qO "$MKCERT_BIN" "$url"
  else
    warn "Neither curl nor wget found. Cannot download mkcert."
    return 1
  fi

  chmod +x "$MKCERT_BIN"
  ok "mkcert downloaded to ${MKCERT_BIN}"
}

# ── Step 2: Install CA into system trust store ────────────────────────
install_ca() {
  info "Installing local CA into system trust store..."
  info "(You may be prompted for your password)"
  if "$MKCERT_BIN" -install 2>&1; then
    ok "Local CA installed"
  else
    warn "mkcert -install failed (admin password may have been declined)"
    warn "Certificates will be generated but may not be trusted by the system"
  fi
}

# ── Step 3: Generate certificates ─────────────────────────────────────
generate_certs() {
  local cert_file="${CERT_DIR}/cert.pem"
  local key_file="${CERT_DIR}/key.pem"

  if [ -f "$cert_file" ] && [ -f "$key_file" ]; then
    ok "Certificates already exist at ${CERT_DIR}"
    return 0
  fi

  info "Generating certificates for localhost..."
  mkdir -p "$CERT_DIR"

  "$MKCERT_BIN" \
    -cert-file "$cert_file" \
    -key-file "$key_file" \
    localhost 127.0.0.1 ::1

  chmod 644 "$cert_file"
  chmod 600 "$key_file"

  ok "Certificate: ${cert_file}"
  ok "Key:         ${key_file}"
}

# ── Step 4: Print NODE_EXTRA_CA_CERTS hint ────────────────────────────
print_hints() {
  local ca_root
  ca_root=$("$MKCERT_BIN" -CAROOT 2>/dev/null || true)

  if [ -n "$ca_root" ] && [ -f "${ca_root}/rootCA.pem" ]; then
    echo ""
    info "Node.js does not use system trust store. Set this env var:"
    printf "  ${BOLD}export NODE_EXTRA_CA_CERTS=\"%s/rootCA.pem\"${RESET}\n" "$ca_root"
    echo ""
  fi
}

# ── Main ──────────────────────────────────────────────────────────────
main() {
  if ! ensure_mkcert; then
    warn "Could not obtain mkcert — skipping certificate generation"
    warn "TLS will not be available. The node will serve plain HTTP."
    exit 0
  fi

  install_ca
  generate_certs
  print_hints
}

main
