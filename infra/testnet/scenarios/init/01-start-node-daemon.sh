#!/usr/bin/env bash
set -euo pipefail

SSH_PASS="${SSH_PASSWORD:-G66tdTcmvBz*k1sf}"
PASSPHRASE="${CLAW_PASSPHRASE:-VLwttmyiMnzZtuTJBEIIPhwmzDB5oh10}"
SERVER_A="${SERVER_A:-173.249.46.252}"
SERVER_B="${SERVER_B:-167.86.93.216}"
SERVER_C="${SERVER_C:-167.86.93.223}"
SERVERS=("$SERVER_A" "$SERVER_B" "$SERVER_C")

for host in "${SERVERS[@]}"; do
  echo "=== Starting daemon on ${host} ==="
  sshpass -p "${SSH_PASS}" ssh -o StrictHostKeyChecking=no "root@${host}" "
    set -e
    cd /opt/clawnet
    pnpm install
    pnpm --filter @claw-network/node build
    mkdir -p /opt/clawnet/node-data
    cat > /opt/clawnet/node.env << ENVEOF
NODE_ENV=production
CLAW_PASSPHRASE=${PASSPHRASE}
CLAW_DEV_FAUCET_API_KEY=testnet-faucet-key
CLAW_DEV_FAUCET_MAX_AMOUNT_PER_CLAIM=20000
CLAW_DEV_FAUCET_COOLDOWN_HOURS=0
CLAW_DEV_FAUCET_MAX_CLAIMS_PER_DID_PER_MONTH=1000
CLAW_DEV_FAUCET_MAX_CLAIMS_PER_IP_PER_DAY=1000
ENVEOF
    chmod 600 /opt/clawnet/node.env

    cat > /etc/systemd/system/clawnetd.service << 'SVCEOF'
[Unit]
Description=ClawNet Node (clawnetd)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/clawnet
EnvironmentFile=/opt/clawnet/node.env
ExecStartPre=/usr/bin/test -f /opt/clawnet/node-data/config.yaml
ExecStart=/usr/bin/node /opt/clawnet/packages/node/dist/daemon.js --api-host 0.0.0.0 --api-port 9528 --data-dir /opt/clawnet/node-data
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
SVCEOF

    systemctl stop clawnetd 2>/dev/null || true
    pkill -f '/opt/clawnet/packages/node/dist/daemon.js' 2>/dev/null || true
    systemctl daemon-reload
    systemctl enable clawnetd
    systemctl restart clawnetd
    sleep 3
    systemctl is-active clawnetd
    ss -lntp | grep ':9528' || true
  "
done

echo "Daemon startup complete (systemd-managed)."
