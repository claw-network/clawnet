#!/usr/bin/env bash
# =============================================================================
# TelAgent Node Deploy — 本地执行脚本
# 将 redeploy.sh 上传到服务器并一键运行。
#
# 用法:
#   bash scripts/telagent/deploy-node.sh <IP或hostname>
#   bash scripts/telagent/deploy-node.sh alex          # 173.249.46.252
#   bash scripts/telagent/deploy-node.sh bess          # 167.86.93.216
#   bash scripts/telagent/deploy-node.sh all           # 依次部署两个节点
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSH_KEY="$HOME/.ssh/id_ed25519_clawnet"
SSH_OPTS="-i $SSH_KEY -o ConnectTimeout=15 -o BatchMode=yes"

resolve_host() {
    case "$1" in
        alex) echo "173.249.46.252" ;;
        bess) echo "167.86.93.216"  ;;
        *)    echo "$1"             ;;
    esac
}

deploy_one() {
    local target="$1"
    local host
    host=$(resolve_host "$target")

    echo ""
    echo "╔══════════════════════════════════════════════════════╗"
    echo "  Deploying to: $target ($host)"
    echo "╚══════════════════════════════════════════════════════╝"

    # Upload redeploy.sh
    echo "[local] Uploading redeploy.sh → root@$host:/opt/redeploy.sh"
    scp $SSH_OPTS "$SCRIPT_DIR/redeploy.sh" "root@$host:/opt/redeploy.sh"

    # Execute
    echo "[local] Running redeploy.sh on $host..."
    ssh $SSH_OPTS "root@$host" 'bash /opt/redeploy.sh'
}

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <alex|bess|all|IP>"
    exit 1
fi

# ── Bump version, commit & push ───────────────────────────────────────────────
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
echo ""
echo "[local] Running bump:patch..."
cd "$REPO_ROOT"
corepack pnpm run bump:patch
NEW_VERSION=$(node -p "require('./package.json').version")
echo "[local] Version bumped to $NEW_VERSION"

echo "[local] Committing & pushing..."
git add -A
git commit -m "chore: bump version to $NEW_VERSION"
git push
echo "[local] Pushed."

case "$1" in
    all)
        deploy_one alex
        deploy_one bess
        ;;
    *)
        deploy_one "$1"
        ;;
esac
