#!/usr/bin/env bash
# ============================================================================
# ClawNet — One-Line Installer
# ============================================================================
# Usage:
#   curl -fsSL https://clawnetd.com/install.sh | bash
#
# Or with options:
#   curl -fsSL https://clawnetd.com/install.sh | bash -s -- \
#     --install-dir /opt/clawnet \
#     --passphrase "my-secure-passphrase" \
#     --api-key "my-api-key" \
#     --systemd \
#     --caddy api.example.com
#
# Environment variables (override flags):
#   CLAWNET_DIR          Install directory        (default: /opt/clawnet)
#   CLAW_PASSPHRASE      Node passphrase          (auto-generated if unset)
#   CLAW_API_KEY         API key for auth          (auto-generated if unset)
#   CLAWNET_BRANCH       Git branch to install     (default: main)
#   CLAWNET_NO_SERVICE   Skip systemd service      (default: false)
#   CLAWNET_CADDY_DOMAIN Domain for Caddy TLS      (optional)
#   CLAWNET_SKIP_BUILD   Skip git clone & build    (default: false)
#   CLAWNET_DATA_DIR     Data directory             (default: /var/lib/clawnet)
# ============================================================================
set -euo pipefail

# ─── Colours & helpers ──────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { printf "${CYAN}▸${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}✔${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}⚠${NC} %s\n" "$*" >&2; }
fail()  { printf "${RED}✖${NC} %s\n" "$*" >&2; exit 1; }

# ─── Defaults ───────────────────────────────────────────────────────────────
INSTALL_DIR="${CLAWNET_DIR:-/opt/clawnet}"
DATA_DIR="${CLAWNET_DATA_DIR:-/var/lib/clawnet}"
BRANCH="${CLAWNET_BRANCH:-main}"
PASSPHRASE="${CLAW_PASSPHRASE:-}"
API_KEY="${CLAW_API_KEY:-}"
SETUP_SYSTEMD=false
CADDY_DOMAIN="${CLAWNET_CADDY_DOMAIN:-}"
SKIP_BUILD="${CLAWNET_SKIP_BUILD:-false}"
REPO_URL="https://github.com/claw-network/clawnet.git"
NODE_MAJOR=20
PNPM_VERSION=10

# ─── Parse flags ────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --install-dir)   INSTALL_DIR="$2";  shift 2 ;;
    --data-dir)      DATA_DIR="$2";     shift 2 ;;
    --branch)        BRANCH="$2";       shift 2 ;;
    --passphrase)    PASSPHRASE="$2";   shift 2 ;;
    --api-key)       API_KEY="$2";      shift 2 ;;
    --systemd)       SETUP_SYSTEMD=true; shift ;;
    --caddy)         CADDY_DOMAIN="$2"; shift 2 ;;
    --skip-build)    SKIP_BUILD=true;   shift ;;
    --help|-h)
      sed -n '2,/^set -/{ /^#/s/^# \{0,1\}//p }' "$0"
      exit 0
      ;;
    *) fail "Unknown flag: $1 (use --help)" ;;
  esac
done

# ─── Detect OS & privilege ──────────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)  OS="linux" ;;
  Darwin) OS="macos" ;;
  *)      fail "Unsupported OS: $OS. This script supports Linux and macOS." ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)             fail "Unsupported architecture: $ARCH" ;;
esac

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    warn "Not running as root and sudo not found — some steps may fail"
  fi
fi

# ─── Package manager detection (Linux) ─────────────────────────────────────
pkg_install() {
  if [ "$OS" = "macos" ]; then
    if ! command -v brew >/dev/null 2>&1; then
      fail "Homebrew not found. Install it: https://brew.sh"
    fi
    brew install "$@"
  elif command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq "$@"
  elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y -q "$@"
  elif command -v yum >/dev/null 2>&1; then
    $SUDO yum install -y -q "$@"
  elif command -v apk >/dev/null 2>&1; then
    $SUDO apk add --no-cache "$@"
  else
    fail "No supported package manager found (apt, dnf, yum, apk, brew)"
  fi
}

# ─── Step 1: Install system dependencies ────────────────────────────────────
info "Checking system dependencies..."

for cmd in git curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    info "Installing $cmd..."
    pkg_install "$cmd"
  fi
done

# Build tools (needed for native modules like classic-level)
if [ "$OS" = "linux" ]; then
  if ! command -v make >/dev/null 2>&1 || ! command -v g++ >/dev/null 2>&1; then
    info "Installing build essentials..."
    if command -v apt-get >/dev/null 2>&1; then
      pkg_install build-essential python3
    elif command -v apk >/dev/null 2>&1; then
      pkg_install python3 make g++
    else
      pkg_install gcc-c++ make python3
    fi
  fi
fi

ok "System dependencies ready"

# ─── Step 2: Install Node.js ────────────────────────────────────────────────
install_node() {
  info "Installing Node.js ${NODE_MAJOR}..."
  if [ "$OS" = "macos" ]; then
    brew install "node@${NODE_MAJOR}"
  elif command -v apt-get >/dev/null 2>&1; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO bash -
    $SUDO apt-get install -y -qq nodejs
  elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO bash -
    pkg_install nodejs
  elif command -v apk >/dev/null 2>&1; then
    pkg_install "nodejs" "npm"
  else
    fail "Cannot auto-install Node.js on this system. Please install Node.js ${NODE_MAJOR}+ manually."
  fi
}

if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node -v | sed 's/v//' | cut -d. -f1)"
  if [ "$NODE_VER" -lt "$NODE_MAJOR" ]; then
    warn "Node.js v${NODE_VER} found but v${NODE_MAJOR}+ required"
    install_node
  else
    ok "Node.js $(node -v) found"
  fi
else
  install_node
fi

# ─── Step 3: Install pnpm ───────────────────────────────────────────────────
if ! command -v pnpm >/dev/null 2>&1; then
  info "Installing pnpm..."
  npm install -g "pnpm@${PNPM_VERSION}" 2>/dev/null || \
    $SUDO npm install -g "pnpm@${PNPM_VERSION}"
fi
ok "pnpm $(pnpm -v) ready"

# ─── Step 4: Clone & Build ──────────────────────────────────────────────────
if [ "$SKIP_BUILD" = "false" ]; then
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing installation in $INSTALL_DIR..."
    cd "$INSTALL_DIR"
    git fetch origin "$BRANCH"
    git checkout "$BRANCH"
    git reset --hard "origin/$BRANCH"
  else
    info "Cloning ClawNet ($BRANCH) into $INSTALL_DIR..."
    $SUDO mkdir -p "$INSTALL_DIR"
    $SUDO chown "$(id -u):$(id -g)" "$INSTALL_DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi

  info "Installing dependencies..."
  pnpm install --frozen-lockfile 2>&1 | tail -5

  info "Building all packages..."
  pnpm build 2>&1 | tail -10
  ok "Build complete"
else
  info "Skipping build (--skip-build)"
  cd "$INSTALL_DIR"
fi

# ─── Step 5: Generate secrets if needed ─────────────────────────────────────
if [ -z "$PASSPHRASE" ]; then
  # Prompt interactively (read from /dev/tty so it works with curl | bash)
  if [ -t 0 ] || [ -e /dev/tty ]; then
    printf "${CYAN}▸${NC} Enter a passphrase for the node (or press Enter to auto-generate): " >&2
    read -r PASSPHRASE < /dev/tty 2>/dev/null || PASSPHRASE=""
  fi
  if [ -z "$PASSPHRASE" ]; then
    PASSPHRASE="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')"
    warn "Auto-generated passphrase (save this!): $PASSPHRASE"
  else
    ok "Passphrase set"
  fi
fi

if [ -z "$API_KEY" ]; then
  API_KEY="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')"
  warn "Generated API key   (save this!): $API_KEY"
fi

# ─── Step 6: Create data directory ──────────────────────────────────────────
$SUDO mkdir -p "$DATA_DIR"
ok "Data directory: $DATA_DIR"

# ─── Step 7: Create systemd service (Linux only) ────────────────────────────
if [ "$OS" = "linux" ] && { [ "$SETUP_SYSTEMD" = "true" ] || [ -d /run/systemd/system ]; }; then
  info "Setting up systemd service..."

  NODE_BIN="$(command -v node)"

  $SUDO tee /etc/systemd/system/clawnet.service > /dev/null << SVCEOF
[Unit]
Description=ClawNet Node — Decentralized Agent Network
Documentation=https://github.com/claw-network/clawnet
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_BIN} packages/node/dist/daemon.js --data-dir ${DATA_DIR} --api-host 127.0.0.1 --api-port 9528 --listen /ip4/0.0.0.0/tcp/9527
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=CLAW_DATA_DIR=${DATA_DIR}
Environment=CLAW_PASSPHRASE=${PASSPHRASE}
Environment=CLAW_API_KEY=${API_KEY}
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
SVCEOF

  $SUDO systemctl daemon-reload
  $SUDO systemctl enable clawnet
  $SUDO systemctl restart clawnet
  ok "systemd service installed and started"

  # Wait for node to come up
  info "Waiting for node to start..."
  for i in $(seq 1 15); do
    if curl -sf http://127.0.0.1:9528/api/node/status >/dev/null 2>&1; then
      ok "Node is running!"
      break
    fi
    sleep 2
  done
else
  if [ "$OS" = "macos" ]; then
    info "To start the node manually:"
    echo ""
    echo "  export CLAW_PASSPHRASE=\"${PASSPHRASE}\""
    echo "  export CLAW_API_KEY=\"${API_KEY}\""
    echo "  cd ${INSTALL_DIR}"
    echo "  node packages/node/dist/daemon.js --data-dir ${DATA_DIR} --api-host 127.0.0.1 --api-port 9528"
    echo ""
  fi
fi

# ─── Step 8: Caddy reverse proxy (optional) ─────────────────────────────────
if [ -n "$CADDY_DOMAIN" ]; then
  info "Configuring Caddy for ${CADDY_DOMAIN}..."

  if ! command -v caddy >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      $SUDO apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null 2>&1 || true
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | $SUDO gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
      $SUDO apt-get update -qq
      $SUDO apt-get install -y -qq caddy
    else
      pkg_install caddy
    fi
  fi

  $SUDO tee /etc/caddy/Caddyfile > /dev/null << CADDYEOF
${CADDY_DOMAIN} {
    # Health check — no auth required
    @health_check {
        path /api/node/status
        method GET
    }
    handle @health_check {
        reverse_proxy localhost:9528
    }

    # Require API key for all other routes
    @no_key {
        not header X-API-Key ${API_KEY}
    }
    handle @no_key {
        respond 401 {
            body "Unauthorized: X-API-Key header required"
            close
        }
    }

    handle {
        reverse_proxy localhost:9528
    }

    header {
        X-Content-Type-Options nosniff
        Strict-Transport-Security "max-age=31536000"
        -Server
    }
}
CADDYEOF

  $SUDO systemctl restart caddy
  ok "Caddy configured for ${CADDY_DOMAIN}"
fi

# ─── Step 9: Firewall (optional, non-destructive) ───────────────────────────
if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q "active"; then
  info "Configuring UFW firewall rules..."
  $SUDO ufw allow 443/tcp  >/dev/null 2>&1 || true   # HTTPS
  $SUDO ufw allow 9527/tcp >/dev/null 2>&1 || true   # P2P
  $SUDO ufw deny  9528/tcp >/dev/null 2>&1 || true   # Block direct API
  ok "Firewall rules applied (443, 9527 open; 9528 blocked)"
fi

# ─── Done ────────────────────────────────────────────────────────────────────
echo ""
printf "${GREEN}══════════════════════════════════════════════════════════${NC}\n"
printf "${GREEN}  ClawNet installed successfully!${NC}\n"
printf "${GREEN}══════════════════════════════════════════════════════════${NC}\n"
echo ""
echo "  Install dir:   ${INSTALL_DIR}"
echo "  Data dir:      ${DATA_DIR}"
echo "  API endpoint:  http://127.0.0.1:9528"
echo "  P2P port:      9527"
if [ -n "$CADDY_DOMAIN" ]; then
echo "  Public URL:    https://${CADDY_DOMAIN}"
fi
echo ""
echo "  ┌──────────────────────────────────────────────────┐"
echo "  │  SAVE THESE CREDENTIALS SECURELY:                │"
echo "  │                                                  │"
printf "  │  Passphrase: ${YELLOW}%-36s${NC} │\n" "$PASSPHRASE"
printf "  │  API Key:    ${YELLOW}%-36s${NC} │\n" "$API_KEY"
echo "  │                                                  │"
echo "  └──────────────────────────────────────────────────┘"
echo ""
echo "  Verify:  curl -s http://127.0.0.1:9528/api/node/status | python3 -m json.tool"
if [ -n "$CADDY_DOMAIN" ]; then
echo "  Public:  curl -s https://${CADDY_DOMAIN}/api/node/status"
fi
echo "  Logs:    journalctl -u clawnet -f"
echo ""
