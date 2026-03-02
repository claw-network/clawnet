#!/usr/bin/env bash
# ClawNet Chain Server — Security Hardening (one-shot)
# Deployed by infra/testnet/deploy.sh or run manually
set -euo pipefail

echo "=== ClawNet Security Hardening ==="
echo "  Host: $(hostname)"
echo "  Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 1. SSH hardening
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
PermitRootLogin prohibit-password
ClientAliveInterval 300
ClientAliveCountMax 2
Banner none
EOF
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
for f in /etc/ssh/sshd_config.d/*.conf; do
  [ -f "$f" ] && [ "$f" != "/etc/ssh/sshd_config.d/99-hardening.conf" ] && \
    sed -i 's/^PasswordAuthentication.*/PasswordAuthentication no/' "$f" 2>/dev/null || true
done
systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true
echo "  [1/8] SSH hardened"

# 2. Fail2ban
apt-get install -y -qq fail2ban >/dev/null 2>&1 || true
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 3
banaction = ufw
ignoreip = 127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16

[sshd]
enabled = true
port = 22
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 24h
findtime = 10m
EOF
systemctl enable fail2ban >/dev/null 2>&1
systemctl restart fail2ban >/dev/null 2>&1
echo "  [2/8] Fail2ban configured"

# 3. Sysctl hardening (config already uploaded)
sysctl -p /etc/sysctl.d/99-clawnet-hardening.conf >/dev/null 2>&1 || true
echo "  [3/8] Kernel hardening applied"

# 4. Docker daemon hardening
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "3" },
  "no-new-privileges": true,
  "live-restore": true
}
EOF
echo "  [4/8] Docker log rotation configured"

# 5. Secure shared memory
grep -q '/run/shm' /etc/fstab || echo 'tmpfs /run/shm tmpfs defaults,noexec,nosuid,nodev 0 0' >> /etc/fstab
echo "  [5/8] Shared memory secured"

# 6. Disable unnecessary services
systemctl disable --now ModemManager.service 2>/dev/null || true
systemctl disable --now packagekit.service 2>/dev/null || true
systemctl disable --now udisks2.service 2>/dev/null || true
echo "  [6/8] Unnecessary services disabled"

# 7. Security audit cron
( (crontab -l 2>/dev/null || true) | (grep -v security-audit || true); echo '0 4 * * * . /opt/clawnet/.smtp-env && /opt/clawnet/security-audit.sh --cron 2>&1 | logger -t clawnet-audit') | crontab -
echo "  [7/8] Daily security audit cron installed"

# 8. Create clawnetd systemd service (if not exists)
if [ ! -f /etc/systemd/system/clawnetd.service ]; then
  cat > /etc/systemd/system/clawnetd.service <<'EOF'
[Unit]
Description=ClawNet Node (clawnetd)
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
ExecStartPre=/usr/bin/test -f /opt/clawnet/node-data/config.yaml
ExecStart=/usr/bin/node /opt/clawnet/packages/node/dist/daemon.js \
  --api-host 0.0.0.0 \
  --api-port 9528 \
  --data-dir /opt/clawnet/node-data
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=clawnetd
WorkingDirectory=/opt/clawnet

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable clawnetd
  echo "  [8/8] clawnetd systemd service created and enabled"
else
  echo "  [8/8] clawnetd systemd service already exists"
fi

echo ""
echo "  ✓ Security hardening complete on $(hostname)"
