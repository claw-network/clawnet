#!/usr/bin/env bash
# =============================================================================
# Deploy install assets (setup.sh, setup.ps1, setup.cmd + mkcert binaries)
# to the Alex server.
# Also verifies Caddy config for install.telagent.org static file serving.
#
# Usage:
#   bash scripts/telagent/deploy-install-assets.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SSH_KEY="$HOME/.ssh/id_ed25519_clawnet"
SSH_OPTS="-i $SSH_KEY -o ConnectTimeout=15 -o BatchMode=yes"
HOST="173.249.46.252"
REMOTE_USER="root"
REMOTE="$REMOTE_USER@$HOST"

REMOTE_ROOT="/var/www/install.telagent.org"
REMOTE_MKCERT_DIR="$REMOTE_ROOT/binaries/mkcert"
LOCAL_MKCERT_DIR="$PROJECT_ROOT/scripts/telagent/mkcert"

DOMAIN="https://install.telagent.org"

# ── Colors ────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${CYAN}[info]${RESET}  %s\n" "$*"; }
ok()    { printf "${GREEN}[ ok ]${RESET}  %s\n" "$*"; }
warn()  { printf "${YELLOW}[warn]${RESET}  %s\n" "$*"; }
fail()  { printf "${RED}[FAIL]${RESET}  %s\n" "$*"; exit 1; }

# ── Step 1: Pre-flight checks ────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "  Deploy install assets → alex ($HOST)"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

info "Running pre-flight checks..."

# Check SSH key
if [ ! -f "$SSH_KEY" ]; then
  fail "SSH key not found: $SSH_KEY"
fi
ok "SSH key exists"

# Check local files
for script_file in setup.sh setup.ps1 setup.cmd; do
  if [ ! -f "$PROJECT_ROOT/scripts/telagent/$script_file" ]; then
    fail "$script_file not found at $PROJECT_ROOT/scripts/telagent/$script_file"
  fi
done
ok "setup.sh, setup.ps1, setup.cmd found"

MKCERT_FILES=$(find "$LOCAL_MKCERT_DIR" -name 'mkcert-v*' -type f 2>/dev/null | wc -l | tr -d ' ')
if [ "$MKCERT_FILES" -eq 0 ]; then
  fail "No mkcert binaries found in $LOCAL_MKCERT_DIR"
fi
ok "Found $MKCERT_FILES mkcert binaries in scripts/telagent/mkcert/"

# Check SSH connectivity
if ! ssh $SSH_OPTS "$REMOTE" "hostname" &>/dev/null; then
  fail "Cannot connect to $REMOTE via SSH"
fi
ok "SSH connection to alex"

# ── Step 2: Check remote environment ─────────────────────────────────
echo ""
info "Checking remote environment..."

# Check Caddy is installed and running
CADDY_STATUS=$(ssh $SSH_OPTS "$REMOTE" "systemctl is-active caddy 2>/dev/null || echo 'inactive'")
if [ "$CADDY_STATUS" != "active" ]; then
  fail "Caddy is not running on alex (status: $CADDY_STATUS). Install/start Caddy first."
fi
ok "Caddy is active"

# Check Caddy config has install.telagent.org
HAS_INSTALL_SITE=$(ssh $SSH_OPTS "$REMOTE" "grep -c 'install.telagent.org' /etc/caddy/Caddyfile 2>/dev/null || echo 0")
if [ "$HAS_INSTALL_SITE" -eq 0 ]; then
  fail "install.telagent.org not found in /etc/caddy/Caddyfile"
fi
ok "install.telagent.org site block exists in Caddyfile"

# Check Caddy config has file_server
HAS_FILE_SERVER=$(ssh $SSH_OPTS "$REMOTE" "grep -c 'file_server' /etc/caddy/Caddyfile 2>/dev/null || echo 0")
if [ "$HAS_FILE_SERVER" -eq 0 ]; then
  fail "file_server not found in Caddyfile — static file serving is not configured"
fi
ok "file_server directive present"

# Check Caddy root points to correct directory
HAS_ROOT=$(ssh $SSH_OPTS "$REMOTE" "grep -c '$REMOTE_ROOT' /etc/caddy/Caddyfile 2>/dev/null || echo 0")
if [ "$HAS_ROOT" -eq 0 ]; then
  fail "Root directory $REMOTE_ROOT not found in Caddyfile"
fi
ok "Caddy root → $REMOTE_ROOT"

# Check binary download path has correct Content-Type (not text/plain)
HAS_BINARY_HEADER=$(ssh $SSH_OPTS "$REMOTE" "grep -c '@binaries' /etc/caddy/Caddyfile 2>/dev/null || echo 0")
if [ "$HAS_BINARY_HEADER" -eq 0 ]; then
  warn "No @binaries matcher found — binary downloads may have wrong Content-Type"
  warn "Expected in Caddyfile: @binaries path /binaries/* + header @binaries Content-Type application/octet-stream"
fi

# ── Step 3: Create remote directories ────────────────────────────────
echo ""
info "Preparing remote directories..."
ssh $SSH_OPTS "$REMOTE" "mkdir -p $REMOTE_MKCERT_DIR"
ok "Remote directory ready: $REMOTE_MKCERT_DIR"

# ── Step 4: Upload setup scripts ─────────────────────────────────────
echo ""
info "Uploading setup scripts..."
for script_file in setup.sh setup.ps1 setup.cmd; do
  scp $SSH_OPTS "$PROJECT_ROOT/scripts/telagent/$script_file" "$REMOTE:$REMOTE_ROOT/$script_file"
  ssh $SSH_OPTS "$REMOTE" "chmod 644 $REMOTE_ROOT/$script_file"
  REMOTE_SIZE=$(ssh $SSH_OPTS "$REMOTE" "wc -c < $REMOTE_ROOT/$script_file")
  LOCAL_SIZE=$(wc -c < "$PROJECT_ROOT/scripts/telagent/$script_file" | tr -d ' ')
  if [ "$REMOTE_SIZE" != "$LOCAL_SIZE" ]; then
    warn "$script_file size mismatch! Local: $LOCAL_SIZE bytes, Remote: $REMOTE_SIZE bytes"
  else
    ok "$script_file uploaded ($LOCAL_SIZE bytes)"
  fi
done
# setup.sh needs execute permission for curl|bash
ssh $SSH_OPTS "$REMOTE" "chmod 755 $REMOTE_ROOT/setup.sh"

# ── Step 5: Upload mkcert binaries ───────────────────────────────────
echo ""
info "Uploading mkcert binaries..."
for f in "$LOCAL_MKCERT_DIR"/mkcert-v*; do
  fname=$(basename "$f")
  scp $SSH_OPTS "$f" "$REMOTE:$REMOTE_MKCERT_DIR/$fname"
  ssh $SSH_OPTS "$REMOTE" "chmod 644 $REMOTE_MKCERT_DIR/$fname"
  ok "  $fname"
done

# ── Step 6: Verify remote file listing ───────────────────────────────
echo ""
info "Remote file listing:"
ssh $SSH_OPTS "$REMOTE" "find $REMOTE_ROOT -type f -exec ls -lh {} \;" | while read -r line; do
  echo "  $line"
done

# ── Step 7: Verify HTTPS downloads ──────────────────────────────────
echo ""
info "Verifying HTTPS downloads..."

# Verify setup scripts
for script_file in setup.sh setup.ps1 setup.cmd; do
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$DOMAIN/$script_file")
  if [ "$HTTP_CODE" = "200" ]; then
    CONTENT_TYPE=$(curl -sI "$DOMAIN/$script_file" | grep -i 'content-type' | tr -d '\r')
    ok "$script_file → HTTP $HTTP_CODE ($CONTENT_TYPE)"
  else
    warn "$script_file → HTTP $HTTP_CODE (expected 200)"
    ALL_OK=false
  fi
done

# Verify each mkcert binary
ALL_OK=true
for f in "$LOCAL_MKCERT_DIR"/mkcert-v*; do
  fname=$(basename "$f")
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$DOMAIN/binaries/mkcert/$fname")
  if [ "$HTTP_CODE" = "200" ]; then
    ok "  $fname → HTTP $HTTP_CODE"
  else
    warn "  $fname → HTTP $HTTP_CODE (expected 200)"
    ALL_OK=false
  fi
done

# ── Summary ──────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
if [ "$ALL_OK" = true ]; then
  printf "${GREEN}${BOLD}  ✓ All assets deployed and verified successfully${RESET}\n"
else
  printf "${YELLOW}${BOLD}  ⚠ Deployed but some downloads failed verification${RESET}\n"
fi
echo ""
echo "  URLs:"
echo "    $DOMAIN/setup.sh"
echo "    $DOMAIN/setup.ps1"
echo "    $DOMAIN/setup.cmd"
echo "    $DOMAIN/binaries/mkcert/"
echo ""
echo "  One-click install:"
echo "    Linux/Mac:          curl -fsSL $DOMAIN/setup.sh | bash"
echo "    Windows PowerShell: iwr -useb $DOMAIN/setup.ps1 | iex"
echo "    Windows CMD:        curl -fsSL $DOMAIN/setup.cmd -o setup.cmd && setup.cmd && del setup.cmd"
echo "════════════════════════════════════════════════════════════"
echo ""
