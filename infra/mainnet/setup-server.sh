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
#   3. Creates data directories
#   4. Configures firewall (UFW)
#   5. Applies kernel tuning for P2P networking
#   6. Creates clawnet system user
#   7. Installs Foundry (cast) for chain interaction
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
info "Step 1/7: Updating system packages..."
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
info "Step 2/7: Installing Docker Engine..."

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
info "Step 3/7: Creating data directories..."

mkdir -p /opt/clawnet/chain-data
mkdir -p /opt/clawnet/config
mkdir -p /var/log/caddy

chmod 750 /opt/clawnet/chain-data
chmod 750 /opt/clawnet/config

info "Data directories created:"
info "  /opt/clawnet/chain-data  — Geth chain data"
info "  /opt/clawnet/config      — genesis.json + password.txt"
info "  /var/log/caddy           — Caddy access logs"
echo ""

# ── Step 4: Firewall (UFW) ───────────────────────────────────────────────────
info "Step 4/7: Configuring firewall..."

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
info "Step 5/7: Applying kernel tuning for P2P networking..."

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
info "Step 6/7: Creating clawnet system user..."

if id "clawnet" &>/dev/null; then
  warn "User 'clawnet' already exists."
else
  useradd -r -s /usr/sbin/nologin -d /opt/clawnet -M clawnet
  usermod -aG docker clawnet
  info "User 'clawnet' created and added to docker group."
fi

chown -R clawnet:clawnet /opt/clawnet

echo ""

# ── Step 7: Install Foundry (cast) ───────────────────────────────────────────
info "Step 7/7: Installing Foundry (cast CLI for chain interaction)..."

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

# ── Summary ──────────────────────────────────────────────────────────────────
echo "============================================================"
echo -e "${GREEN}  ClawNet Mainnet Server Setup Complete!${NC}"
echo "============================================================"
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
