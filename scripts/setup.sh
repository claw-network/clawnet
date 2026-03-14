#!/usr/bin/env bash
# ============================================================================
# ClawNet — One-Click Local Development Setup
# ============================================================================
# Usage:
#   curl -fsSL https://clawnetd.com/setup.sh | bash
#
# Or run locally:
#   bash scripts/setup.sh
#
# What it does:
#   1. Checks prerequisites (Node.js >=20, pnpm >=10, git)
#   2. Clones the ClawNet repo (or pulls if already cloned)
#   3. Installs dependencies via pnpm
#   4. Generates passphrase, API key, and optional EVM signer key
#   5. Creates .env with generated values
#   6. Builds workspace packages
#   7. Installs and starts ClawNet as a system service
#      - Linux: systemd user service (~/.config/systemd/user/clawnetd.service)
#      - macOS: launchd agent (~/Library/LaunchAgents/com.clawnet.node.plist)
#
# Environment variables:
#   CLAWNET_INSTALL_DIR   Install directory (default: ~/clawnet)
#   CLAWNET_BRANCH        Git branch        (default: main)
#   CLAWNET_NETWORK       Network type      (default: testnet)
#
# Windows users should use setup.ps1 (PowerShell) or setup.cmd instead.
# ============================================================================
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${CYAN}[info]${RESET}  %s\n" "$*"; }
ok()    { printf "${GREEN}[ok]${RESET}    %s\n" "$*"; }
warn()  { printf "${YELLOW}[warn]${RESET}  %s\n" "$*"; }
fail()  { printf "${RED}[error]${RESET} %s\n" "$*" >&2; exit 1; }

# ── Config ────────────────────────────────────────────────────────────
REPO_URL="https://github.com/claw-network/clawnet.git"
INSTALL_DIR="${CLAWNET_INSTALL_DIR:-$HOME/clawnet}"
BRANCH="${CLAWNET_BRANCH:-main}"
NETWORK="${CLAWNET_NETWORK:-testnet}"
NODE_MIN=20
NODE_MAX=24
PNPM_MIN=10
DATA_DIR="$HOME/.clawnet"

echo ""
printf "  ${BOLD}ClawNet Local Setup${RESET}\n"
echo ""

# ── Step 1: Prerequisites ────────────────────────────────────────────
info "Checking prerequisites..."

# Node.js
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install Node.js >= ${NODE_MIN} first: https://nodejs.org or use fnm/nvm"
fi
NODE_VER=$(node -v | sed 's/^v//')
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt "$NODE_MIN" ] || [ "$NODE_MAJOR" -gt "$NODE_MAX" ]; then
  fail "Node.js v${NODE_VER} is not supported. Need >= ${NODE_MIN} < $((NODE_MAX + 1)). Use: fnm install ${NODE_MIN} && fnm use ${NODE_MIN}"
fi
ok "Node.js v${NODE_VER}"

# pnpm
if ! command -v pnpm &>/dev/null; then
  info "pnpm not found, installing via corepack..."
  corepack enable
  corepack prepare pnpm@latest --activate
fi
PNPM_VER=$(pnpm -v)
PNPM_MAJOR=$(echo "$PNPM_VER" | cut -d. -f1)
if [ "$PNPM_MAJOR" -lt "$PNPM_MIN" ]; then
  fail "pnpm ${PNPM_VER} is too old. Need >= ${PNPM_MIN}. Run: corepack prepare pnpm@latest --activate"
fi
ok "pnpm v${PNPM_VER}"

# git
if ! command -v git &>/dev/null; then
  fail "git not found. Install git first."
fi
ok "git $(git --version | awk '{print $3}')"

# Build tools (needed for native modules like classic-level, better-sqlite3)
OS="$(uname -s)"
if [ "$OS" = "Linux" ]; then
  if ! command -v make &>/dev/null || ! command -v g++ &>/dev/null; then
    warn "Build tools (make, g++) not found. Native modules may fail to compile."
    warn "Install via: sudo apt install build-essential python3  (Debian/Ubuntu)"
    warn "         or: sudo dnf install gcc-c++ make python3     (Fedora/RHEL)"
  fi
fi

# ── Step 2: Clone or update repo ─────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Existing repo found at ${INSTALL_DIR}, pulling latest..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "Cloning ClawNet (${BRANCH}) to ${INSTALL_DIR}..."
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
ok "Repo ready at ${INSTALL_DIR}"

cd "$INSTALL_DIR"

# ── Step 3: Install dependencies ─────────────────────────────────────
info "Installing dependencies (this may take a minute)..."
pnpm install --frozen-lockfile
ok "Dependencies installed"

# ── Step 4: Generate secrets & .env ───────────────────────────────────
if [ -f .env ]; then
  BACKUP=".env.backup.$(date +%Y%m%d%H%M%S)"
  warn ".env already exists, backing up to ${BACKUP}"
  cp .env "$BACKUP"
fi

info "Generating secrets..."

# Generate passphrase (64 hex chars)
PASSPHRASE=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Generate API key (64 hex chars)
API_KEY=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Generate EVM private key
EVM_OUTPUT=$(node --input-type=module -e "
  import { Wallet } from 'ethers';
  const w = Wallet.createRandom();
  console.log(JSON.stringify({ privateKey: w.privateKey, address: w.address }));
" 2>/dev/null || echo '{}')

PRIVATE_KEY=$(echo "$EVM_OUTPUT" | node -e "const d=require('fs').readFileSync(0,'utf8');try{console.log(JSON.parse(d).privateKey)}catch{console.log('')}" 2>/dev/null || echo "")
EVM_ADDRESS=$(echo "$EVM_OUTPUT" | node -e "const d=require('fs').readFileSync(0,'utf8');try{console.log(JSON.parse(d).address)}catch{console.log('')}" 2>/dev/null || echo "")

info "Creating .env..."

# Determine chain RPC and contract addresses based on network
case "$NETWORK" in
  mainnet)
    CHAIN_RPC_URL="https://rpc.clawnet.network"
    ;;
  testnet)
    CHAIN_RPC_URL="https://rpc.clawnetd.com"
    ;;
  devnet|*)
    CHAIN_RPC_URL="http://127.0.0.1:8545"
    ;;
esac

# Read contract addresses from prod contracts.json if available
IDENTITY_CONTRACT=""
if [ -f "infra/testnet/prod/contracts.json" ]; then
  IDENTITY_CONTRACT=$(node -e "
    try {
      const c = require('./infra/testnet/prod/contracts.json');
      console.log(c.ClawIdentity || c.identity || '');
    } catch { console.log(''); }
  " 2>/dev/null || echo "")
fi

cat > .env << ENVEOF
# ============================================================================
# ClawNet Local Development Configuration
# Generated by setup.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# ============================================================================

# ── Network ──────────────────────────────────────────────────────────
CLAW_NETWORK=${NETWORK}

# ── Node Identity ────────────────────────────────────────────────────
# Passphrase for encrypting the node identity key (REQUIRED)
CLAW_PASSPHRASE=${PASSPHRASE}

# API key for authenticated REST endpoints
CLAW_API_KEY=${API_KEY}

# ── Chain Configuration ──────────────────────────────────────────────
CLAW_CHAIN_RPC_URL=${CHAIN_RPC_URL}
CLAW_CHAIN_ID=7625

# EVM signer private key (for on-chain transactions)
CLAW_PRIVATE_KEY=${PRIVATE_KEY}

# ── Contract Addresses ───────────────────────────────────────────────
$([ -n "$IDENTITY_CONTRACT" ] && echo "CLAW_CHAIN_IDENTITY_CONTRACT=${IDENTITY_CONTRACT}" || echo "# CLAW_CHAIN_IDENTITY_CONTRACT=  # Set after contract deployment")

# ── Storage ──────────────────────────────────────────────────────────
# CLAWNET_HOME=${DATA_DIR}

# ── API Server ───────────────────────────────────────────────────────
# CLAW_API_HOST=127.0.0.1
# CLAW_API_PORT=9528

# ── P2P ──────────────────────────────────────────────────────────────
# CLAW_P2P_LISTEN=/ip4/0.0.0.0/tcp/9527
ENVEOF

ok ".env created"
echo ""
printf "  ${BOLD}Passphrase:${RESET}    %s\n" "$PASSPHRASE"
printf "  ${BOLD}API Key:${RESET}       %s\n" "$API_KEY"
if [ -n "$EVM_ADDRESS" ]; then
  printf "  ${BOLD}EVM Address:${RESET}   %s\n" "$EVM_ADDRESS"
fi
echo ""
warn "Save these credentials! They are stored in .env — do not commit it to git."

# ── Step 5: Create data directory ─────────────────────────────────────
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"
ok "Data directory: ${DATA_DIR}"

# ── Step 6: Build workspace packages ─────────────────────────────────
info "Building workspace packages..."
pnpm build 2>&1 | tail -20
ok "Build complete"

# ── Step 7: Detect OS and install service ─────────────────────────────
PNPM_PATH="$(command -v pnpm)"
NODE_PATH="$(command -v node)"
NODE_BIN_DIR="${NODE_PATH%/*}"

install_linux_service() {
  info "Setting up systemd user service..."
  SYSTEMD_DIR="$HOME/.config/systemd/user"
  mkdir -p "$SYSTEMD_DIR"

  cat > "$SYSTEMD_DIR/clawnetd.service" << EOF
[Unit]
Description=ClawNet Node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_PATH} packages/node/dist/daemon.js --data-dir ${DATA_DIR} --network ${NETWORK}
Restart=always
RestartSec=5
Environment=PATH=${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
EnvironmentFile=${INSTALL_DIR}/.env

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable clawnetd.service
  systemctl --user start clawnetd.service

  # Enable lingering so the user service runs without an active login session
  if command -v loginctl &>/dev/null; then
    loginctl enable-linger "$(whoami)" 2>/dev/null || true
  fi

  ok "systemd user service installed and started"
  echo ""
  echo "  Manage the service:"
  echo "    systemctl --user status clawnetd"
  echo "    systemctl --user stop clawnetd"
  echo "    systemctl --user restart clawnetd"
  echo "    journalctl --user -u clawnetd -f"
}

install_macos_service() {
  info "Setting up launchd agent..."
  LAUNCH_DIR="$HOME/Library/LaunchAgents"
  LOG_DIR="$DATA_DIR/logs"
  PLIST="$LAUNCH_DIR/com.clawnet.node.plist"
  mkdir -p "$LAUNCH_DIR" "$LOG_DIR"

  cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.clawnet.node</string>
  <key>WorkingDirectory</key>
  <string>${INSTALL_DIR}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>packages/node/dist/daemon.js</string>
    <string>--data-dir</string>
    <string>${DATA_DIR}</string>
    <string>--network</string>
    <string>${NETWORK}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin</string>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>CLAW_PASSPHRASE</key>
    <string>${PASSPHRASE}</string>
    <key>CLAW_API_KEY</key>
    <string>${API_KEY}</string>
    <key>CLAW_PRIVATE_KEY</key>
    <string>${PRIVATE_KEY}</string>
    <key>CLAW_NETWORK</key>
    <string>${NETWORK}</string>
    <key>CLAW_CHAIN_RPC_URL</key>
    <string>${CHAIN_RPC_URL}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/clawnetd-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/clawnetd-stderr.log</string>
</dict>
</plist>
EOF

  # Unload first if already loaded (ignore errors)
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"

  ok "launchd agent installed and started"
  echo ""
  echo "  Manage the service:"
  echo "    launchctl list | grep clawnet"
  echo "    launchctl unload ~/Library/LaunchAgents/com.clawnet.node.plist   # stop"
  echo "    launchctl load ~/Library/LaunchAgents/com.clawnet.node.plist     # start"
  echo "    tail -f ${LOG_DIR}/clawnetd-stderr.log                          # logs"
}

start_foreground() {
  warn "Could not install system service. Starting ClawNet in the foreground..."
  echo ""
  echo "  To start manually later:"
  echo "    cd ${INSTALL_DIR} && node packages/node/dist/daemon.js --data-dir ${DATA_DIR} --network ${NETWORK}"
  echo ""
  cd "$INSTALL_DIR"
  exec node packages/node/dist/daemon.js --data-dir "$DATA_DIR" --network "$NETWORK"
}

echo ""
case "$(uname -s)" in
  Linux*)
    if command -v systemctl &>/dev/null; then
      install_linux_service
    else
      start_foreground
    fi
    ;;
  Darwin*)
    install_macos_service
    ;;
  MINGW*|MSYS*|CYGWIN*)
    fail "Windows detected. Please use setup.ps1 or setup.cmd instead:\n  PowerShell: iwr -useb https://clawnetd.com/setup.ps1 | iex\n  CMD:        curl -fsSL https://clawnetd.com/setup.cmd -o setup.cmd && setup.cmd && del setup.cmd"
    ;;
  *)
    start_foreground
    ;;
esac

# ── Step 8: Wait for node to be ready ─────────────────────────────────
info "Waiting for ClawNet node to start..."
READY=false
HEALTH_URL="http://127.0.0.1:9528/api/v1/node"

for i in $(seq 1 15); do
  if curl -fs "$HEALTH_URL" >/dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 2
done

echo ""
if [ "$READY" = true ]; then
  printf "${GREEN}${BOLD}ClawNet is running!${RESET}\n"
  echo ""

  # Try to fetch node DID
  NODE_INFO=$(curl -fs -H "X-Api-Key: ${API_KEY}" "http://127.0.0.1:9528/api/v1/identity" 2>/dev/null || echo '{}')
  DID=$(echo "$NODE_INFO" | node -e "const d=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(d);console.log(j.data?.did||j.did||'')}catch{console.log('')}" 2>/dev/null || echo "")
  if [ -n "$DID" ]; then
    printf "  ${BOLD}Your DID:${RESET}  %s\n" "$DID"
    echo ""
  fi

  echo "  API:    http://127.0.0.1:9528"
  echo "  P2P:    /ip4/0.0.0.0/tcp/9527"
  echo ""
  echo "  Verify: curl -s -H 'X-Api-Key: ${API_KEY}' http://127.0.0.1:9528/api/v1/node | python3 -m json.tool"
else
  printf "${YELLOW}${BOLD}ClawNet installed but node may still be starting.${RESET}\n"
  echo ""
  echo "  Check status:"
  case "$(uname -s)" in
    Darwin*)
      echo "    launchctl list | grep clawnet"
      echo "    tail -f ${DATA_DIR}/logs/clawnetd-stderr.log"
      ;;
    *)
      echo "    systemctl --user status clawnetd"
      echo "    journalctl --user -u clawnetd -f"
      ;;
  esac
  echo ""
  echo "  Once running, the API is at http://127.0.0.1:9528"
fi

echo ""
printf "  ${BOLD}Credentials (save these!):${RESET}\n"
printf "    Passphrase: ${YELLOW}%s${RESET}\n" "$PASSPHRASE"
printf "    API Key:    ${YELLOW}%s${RESET}\n" "$API_KEY"
if [ -n "$EVM_ADDRESS" ]; then
  printf "    EVM Addr:   ${YELLOW}%s${RESET}\n" "$EVM_ADDRESS"
fi
echo ""
