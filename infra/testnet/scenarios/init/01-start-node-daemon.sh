#!/usr/bin/env bash
set -euo pipefail

SSH_PASS="${SSH_PASSWORD:-G66tdTcmvBz*k1sf}"
PASSPHRASE="${CLAW_PASSPHRASE:-VLwttmyiMnzZtuTJBEIIPhwmzDB5oh10}"
SERVERS=(173.249.46.252 167.86.93.216 167.86.93.223)

for host in "${SERVERS[@]}"; do
  echo "=== Starting daemon on ${host} ==="
  sshpass -p "${SSH_PASS}" ssh -o StrictHostKeyChecking=no "root@${host}" "
    set -e
    cd /opt/clawnet
    pnpm install
    pnpm --filter @claw-network/node build
    mkdir -p /opt/clawnet/node-data
    pkill -f 'node /opt/clawnet/packages/node/dist/daemon.js' || true
    nohup env CLAW_PASSPHRASE='${PASSPHRASE}' \
      CLAW_DEV_FAUCET_API_KEY='testnet-faucet-key' \
      CLAW_DEV_FAUCET_MAX_AMOUNT_PER_CLAIM='20000' \
      CLAW_DEV_FAUCET_COOLDOWN_HOURS='0' \
      CLAW_DEV_FAUCET_MAX_CLAIMS_PER_DID_PER_MONTH='1000' \
      CLAW_DEV_FAUCET_MAX_CLAIMS_PER_IP_PER_DAY='1000' \
      node /opt/clawnet/packages/node/dist/daemon.js \
      --api-host 0.0.0.0 --api-port 9528 --data-dir /opt/clawnet/node-data \
      > /opt/clawnet/node.log 2>&1 &
    sleep 3
    ss -lntp | grep ':9528' || true
  "
done

echo "Daemon startup complete."
