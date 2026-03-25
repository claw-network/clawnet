#!/usr/bin/env bash
# =============================================================================
# TelAgent Node Remote Redeploy Script
# 运行在服务器上，一键完成全量重新部署。
# 用法: bash /opt/redeploy.sh
# =============================================================================
set -euo pipefail

REPO="https://github.com/claw-network/clawnet.git"
DEPLOY_DIR="/opt/clawnet"
ENV_BAK="/tmp/.env.cloud.bak"

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
ok()   { echo "[$(date '+%H:%M:%S')] ✓ $*"; }
fail() { echo "[$(date '+%H:%M:%S')] ✗ $*" >&2; exit 1; }

# ── Step 1: Backup env ────────────────────────────────────────────────────────
log "Step 1: Backup .env.cloud"
[[ -f "$DEPLOY_DIR/.env.cloud" ]] || fail ".env.cloud not found at $DEPLOY_DIR"
cp "$DEPLOY_DIR/.env.cloud" "$ENV_BAK"
ok "Backed up to $ENV_BAK"

# ── Step 2: Fresh clone ───────────────────────────────────────────────────────
log "Step 2: Fresh clone from $REPO"
rm -rf "$DEPLOY_DIR"
git clone --depth 1 "$REPO" "$DEPLOY_DIR"
cp "$ENV_BAK" "$DEPLOY_DIR/.env.cloud"
COMMIT=$(cd "$DEPLOY_DIR" && git log --oneline -1)
ok "Cloned: $COMMIT"

# ── Step 3: Install dependencies ─────────────────────────────────────────────
log "Step 3: pnpm install"
cd "$DEPLOY_DIR"
corepack pnpm install --frozen-lockfile 2>&1 | tail -3
ok "Dependencies installed"

# ── Step 4: Start script check ───────────────────────────────────────────────
log "Step 4: Start script already uses service-provided env; no patch needed"
ok "Start script left unchanged"

# ── Step 5: Build workspace packages ─────────────────────────────────────────
log "Step 5: Build @claw-network/client"
corepack pnpm --filter @claw-network/client build 2>&1 | tail -3
ok "Client package built"

# ── Step 6: Restart clawnetd ─────────────────────────────────────────────────
log "Step 6: Restart clawnetd"
systemctl restart clawnetd || true

# Wait up to 30s for systemd state to become active
for i in $(seq 1 6); do
    STATE=$(systemctl is-active clawnetd 2>/dev/null || true)
    if [[ "$STATE" == "active" ]]; then
        ok "clawnetd is active"
        break
    fi
    log "  clawnetd state=$STATE, waiting... ($i/6)"
    sleep 5
done

# If still not active, force kill aux processes and start fresh
STATE=$(systemctl is-active clawnetd 2>/dev/null || true)
if [[ "$STATE" != "active" ]]; then
    log "  Force-killing clawnetd and restarting..."
    systemctl kill -s SIGKILL clawnetd 2>/dev/null || true
    sleep 2
    systemctl reset-failed clawnetd 2>/dev/null || true
    systemctl start clawnetd
    sleep 5
    STATE=$(systemctl is-active clawnetd 2>/dev/null || true)
    [[ "$STATE" == "active" ]] || fail "clawnetd failed to start (state=$STATE)"
    ok "clawnetd is active (after force restart)"
fi

# Wait for ClawNet API to actually be reachable (systemd active ≠ API ready)
log "Step 6b: Waiting for ClawNet API on :9528..."
for i in $(seq 1 30); do
    if curl -sf --max-time 2 http://127.0.0.1:9528/api/v1/node > /dev/null 2>&1; then
        ok "ClawNet API is ready"
        break
    fi
    if [[ $i -eq 30 ]]; then
        fail "ClawNet API not reachable after 60s"
    fi
    sleep 2
done

# ── Step 7: Restart telagent-node ────────────────────────────────────────────
log "Step 7: Restart telagent-node"
systemctl restart telagent-node

# Wait up to 30s for telagent-node to become active (may need chain sync)
for i in $(seq 1 6); do
    sleep 5
    STATE=$(systemctl is-active telagent-node 2>/dev/null || true)
    if [[ "$STATE" == "active" ]]; then
        ok "telagent-node is active"
        break
    fi
    if [[ $i -eq 6 ]]; then
        fail "telagent-node failed to start (state=$STATE)"
    fi
    log "  telagent-node state=$STATE, waiting... ($i/6)"
done

# ── Step 8: Quick health check ───────────────────────────────────────────────
log "Step 8: Health check"
RESP=$(curl -s --max-time 5 http://127.0.0.1:9529/api/v1/node/ || true)
if echo "$RESP" | grep -q '"service":"telagent-node"'; then
    ok "API responding: $RESP"
else
    log "  API not yet ready (may still be starting): $RESP"
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  DEPLOY COMPLETE"
echo "  Commit: $COMMIT"
echo "  clawnetd:      $(systemctl is-active clawnetd)"
echo "  telagent-node: $(systemctl is-active telagent-node)"
echo "============================================"
