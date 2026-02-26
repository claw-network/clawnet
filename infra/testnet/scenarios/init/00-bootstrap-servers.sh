#!/usr/bin/env bash
set -euo pipefail

SSH_PASS="${SSH_PASSWORD:-G66tdTcmvBz*k1sf}"
SERVERS=(173.249.46.252 167.86.93.216 167.86.93.223)

for host in "${SERVERS[@]}"; do
  echo "=== Bootstrapping ${host} ==="
  sshpass -p "${SSH_PASS}" ssh -o StrictHostKeyChecking=no "root@${host}" '
    set -e
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg git jq

    if ! command -v docker >/dev/null; then
      curl -fsSL https://get.docker.com | sh
      systemctl enable docker
      systemctl start docker
    fi

    if ! command -v node >/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y nodejs
    fi

    if ! command -v pnpm >/dev/null; then
      npm install -g pnpm
    fi

    mkdir -p /opt
    if [ ! -d /opt/clawnet/.git ]; then
      git clone https://github.com/claw-network/clawnet.git /opt/clawnet
    else
      cd /opt/clawnet
      git fetch --all --prune
      git checkout main
      git pull --ff-only
    fi

    mkdir -p /opt/clawnet/chain-data /opt/clawnet/config
  '
done

echo "Bootstrap complete."
