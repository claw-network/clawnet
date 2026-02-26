#!/usr/bin/env bash
# ==============================================================================
# ClawNet Mainnet — Server Initial Setup Script
# ==============================================================================
# Aligned with infra/testnet/setup-server.sh for mainnet servers.
#
# Run on a fresh Ubuntu 22.04/24.04 server:
#   scp setup-server.sh user@server:/tmp/ && ssh user@server 'bash /tmp/setup-server.sh'
#
# This script:
#   1. Updates system packages
#   2. Installs Docker Engine + Docker Compose
#   3. Creates data directories (chain + clawnetd)
#   4. Configures firewall (UFW)
#   5. Applies kernel tuning for P2P networking
#   6. Creates clawnet system user
#   7. Installs Node.js 20 + pnpm (for clawnetd)
#   8. Installs sqlite3 (for EventIndexer inspection)
#   9. Installs Foundry (cast) for chain interaction
#  10. Hardens SSH (disable password auth, key-only login)
# ==============================================================================

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Pre-checks ───────────────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || error "This script must be run as root (sudo)"

info "Starting ClawNet Mainnet server setup..."
info "Hostname: $(hostname)"
info "OS: $(cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"')"
echo ""

# ── Step 1: System Update ────────────────────────────────────────────────────
info "Step 1/10: Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y \
  curl \
  wget \
  git \
  jq \
  htop \
  tmux \
  unzip \
  ca-certificates \
  gnupg \
  lsb-release \
  software-properties-common \
  fail2ban \
  logrotate

info "System packages updated."
echo ""

# ── Step 2: Install Docker ───────────────────────────────────────────────────
info "Step 2/10: Installing Docker Engine..."

if command -v docker &>/dev/null; then
  warn "Docker already installed: $(docker --version)"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

  systemctl enable docker
  systemctl start docker

  info "Docker installed: $(docker --version)"
fi

if docker compose version &>/dev/null; then
  info "Docker Compose: $(docker compose version --short)"
else
  error "Docker Compose plugin not found!"
fi

echo ""

# ── Step 3: Create Data Directories ──────────────────────────────────────────
info "Step 3/10: Creating data directories..."

mkdir -p /opt/clawnet/chain-data
mkdir -p /opt/clawnet/config
mkdir -p /opt/clawnet/clawnetd-data
mkdir -p /var/log/caddy

chmod 750 /opt/clawnet/chain-data
chmod 750 /opt/clawnet/config
chmod 750 /opt/clawnet/clawnetd-data

info "Data directories created:"
info "  /opt/clawnet/chain-data     — Geth chain data"
info "  /opt/clawnet/config         — genesis.json + password.txt"
info "  /opt/clawnet/clawnetd-data  — clawnetd state + indexer.sqlite"
info "  /var/log/caddy              — Caddy access logs"
echo ""

# ── Step 4: Firewall (UFW) ───────────────────────────────────────────────────
info "Step 4/10: Configuring firewall..."

if command -v ufw &>/dev/null; then
  ufw default deny incoming
  ufw default allow outgoing

  ufw allow 22/tcp comment "SSH"
  ufw allow 30303/tcp comment "Geth P2P TCP"
  ufw allow 30303/udp comment "Geth P2P UDP (discovery)"
  ufw allow 9527/tcp comment "clawnetd P2P"
  ufw allow 443/tcp comment "HTTPS (Caddy)"
  ufw allow 80/tcp comment "HTTP (ACME)"

  echo "y" | ufw enable
  ufw status verbose

  info "Firewall configured."
else
  warn "UFW not found, skipping firewall setup. Install manually."
fi

echo ""

# ── Step 5: Kernel Tuning ────────────────────────────────────────────────────
info "Step 5/10: Applying kernel tuning for P2P networking..."

SYSCTL_CONF="/etc/sysctl.d/99-clawnet.conf"

cat > "$SYSCTL_CONF" << 'EOF'
# ClawNet P2P Networking Tuning
fs.file-max = 65535
net.core.somaxconn = 4096
net.core.netdev_max_backlog = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.netfilter.nf_conntrack_max = 131072
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_keepalive_time = 120
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 3
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
EOF

sysctl -p "$SYSCTL_CONF"

cat > /etc/security/limits.d/99-clawnet.conf << 'EOF'
*    soft    nofile    65535
*    hard    nofile    65535
root soft    nofile    65535
root hard    nofile    65535
EOF

info "Kernel tuning applied."
echo ""

# ── Step 6: Create System User ───────────────────────────────────────────────
info "Step 6/10: Creating clawnet system user..."

if id "clawnet" &>/dev/null; then
  warn "User 'clawnet' already exists."
else
  useradd -r -s /usr/sbin/nologin -d /opt/clawnet -M clawnet
  usermod -aG docker clawnet
  info "User 'clawnet' created and added to docker group."
fi

chown -R clawnet:clawnet /opt/clawnet

echo ""

# ── Step 7: Install Node.js + pnpm ───────────────────────────────────────────
info "Step 7/10: Installing Node.js 20 + pnpm (for clawnetd)..."

if command -v node &>/dev/null; then
  warn "Node.js already installed: $(node --version)"
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  info "Node.js installed: $(node --version)"
fi

if command -v pnpm &>/dev/null; then
  warn "pnpm already installed: $(pnpm --version)"
else
  npm install -g pnpm
  info "pnpm installed: $(pnpm --version)"
fi

echo ""

# ── Step 8: Install sqlite3 ──────────────────────────────────────────────────
info "Step 8/10: Installing sqlite3 (for EventIndexer DB inspection)..."

if command -v sqlite3 &>/dev/null; then
  warn "sqlite3 already installed: $(sqlite3 --version | head -1)"
else
  apt-get install -y sqlite3
  info "sqlite3 installed: $(sqlite3 --version | head -1)"
fi

echo ""

# ── Step 9: Install Foundry (cast) ───────────────────────────────────────────
info "Step 9/10: Installing Foundry (cast CLI for chain interaction)..."

if command -v cast &>/dev/null; then
  warn "Foundry already installed: $(cast --version 2>/dev/null || echo 'unknown')"
else
  curl -L https://foundry.paradigm.xyz | bash
  export PATH="$HOME/.foundry/bin:$PATH"

  if command -v foundryup &>/dev/null; then
    foundryup
    info "Foundry installed: $(cast --version 2>/dev/null || echo 'check PATH')"
  else
    warn "foundryup not found in PATH. Run manually: foundryup"
  fi
fi

echo ""

# ── Step 10: Harden SSH ───────────────────────────────────────────────────────
info "Step 10/10: Hardening SSH (disable password, key-only login)..."

# Source .env if present (for ADMIN_SSH_PUBKEY)
if [ -f /opt/clawnet/.env ]; then
  source /opt/clawnet/.env 2>/dev/null || true
fi

# Accept admin public key: env var > .env file > command-line arg
ADMIN_PUBKEY="${ADMIN_SSH_PUBKEY:-${1:-}}"

if [ -n "$ADMIN_PUBKEY" ]; then
  # Install the admin public key
  mkdir -p /root/.ssh
  chmod 700 /root/.ssh
  echo "$ADMIN_PUBKEY" >> /root/.ssh/authorized_keys
  sort -u /root/.ssh/authorized_keys -o /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
  info "Admin SSH public key installed."
else
  # Check if any authorized keys already exist
  if [ ! -f /root/.ssh/authorized_keys ] || [ ! -s /root/.ssh/authorized_keys ]; then
    warn "No ADMIN_SSH_PUBKEY provided and no existing authorized_keys found!"
    warn "Skipping SSH hardening to avoid lockout."
    warn "Run again with: ADMIN_SSH_PUBKEY='ssh-ed25519 AAAA...' bash setup-server.sh"
    echo ""
    SKIP_SSH_HARDEN=1
  fi
fi

if [ "${SKIP_SSH_HARDEN:-0}" != "1" ]; then
  # Backup sshd_config
  cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$(date +%Y%m%d) 2>/dev/null || true

  # Disable password authentication
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  sed -i 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
  sed -i 's/^#\?KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
  sed -i 's/^#\?UsePAM.*/UsePAM no/' /etc/ssh/sshd_config

  # Ensure pubkey auth is enabled
  sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config

  # PermitRootLogin = key only
  if grep -q "^PermitRootLogin" /etc/ssh/sshd_config; then
    sed -i 's/^PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
  else
    echo "PermitRootLogin prohibit-password" >> /etc/ssh/sshd_config
  fi

  # Handle sshd_config.d drop-in overrides (Ubuntu 24.04)
  if [ -d /etc/ssh/sshd_config.d ]; then
    for f in /etc/ssh/sshd_config.d/*.conf; do
      [ -f "$f" ] || continue
      sed -i 's/^PasswordAuthentication.*/PasswordAuthentication no/' "$f"
      sed -i 's/^ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' "$f"
      sed -i 's/^KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' "$f"
    done
  fi

  # Test config before restart
  if sshd -t 2>/dev/null; then
    systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true
    info "SSH hardened: password auth disabled, key-only login enabled."
    info "  PermitRootLogin = prohibit-password"
    info "  PasswordAuthentication = no"
    info "  PubkeyAuthentication = yes"
  else
    warn "sshd config test failed! Reverting to backup..."
    cp /etc/ssh/sshd_config.bak.$(date +%Y%m%d) /etc/ssh/sshd_config 2>/dev/null || true
    systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true
    warn "SSH config reverted. Please check manually."
  fi
fi

echo ""

# ── Summary ──────────────────────────────────────────────────────────────────
echo "============================================================"
echo -e "${GREEN}  ClawNet Mainnet Server Setup Complete!${NC}"
echo "============================================================"
echo ""
echo "  Usage (with SSH hardening):"
echo "    ADMIN_SSH_PUBKEY='ssh-ed25519 AAAA...' bash setup-server.sh"
echo "    -- or pass existing authorized_keys, then run without arg --"
echo ""
echo "  Next steps:"
echo "  1. Copy deployment files to /opt/clawnet/"
echo "     scp infra/mainnet/* root@server:/opt/clawnet/"
echo ""
echo "  2. Create .env from template:"
echo "     cp /opt/clawnet/.env.example /opt/clawnet/.env"
echo "     nano /opt/clawnet/.env"
echo ""
echo "  3. Initialize & start:"
echo "     Follow the guide in infra/mainnet/README.md"
echo ""
echo "  4. Verify with health check:"
echo "     /opt/clawnet/health-check.sh"
echo ""
echo "============================================================"
