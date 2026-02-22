#!/usr/bin/env bash
# ==============================================================================
# ClawNet Chain — Server Initial Setup Script
# ==============================================================================
# Run on a fresh Ubuntu 22.04/24.04 server:
#   curl -sL https://raw.githubusercontent.com/.../setup-server.sh | bash
#   -- or --
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

info "Starting ClawNet server setup..."
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
  # Add Docker GPG key
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  # Add Docker repository
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

  # Enable Docker service
  systemctl enable docker
  systemctl start docker

  info "Docker installed: $(docker --version)"
fi

# Docker Compose (verify)
if docker compose version &>/dev/null; then
  info "Docker Compose: $(docker compose version --short)"
else
  error "Docker Compose plugin not found!"
fi

echo ""

# ── Step 3: Create Data Directories ──────────────────────────────────────────
info "Step 3/7: Creating data directories..."

mkdir -p /data/reth
mkdir -p /data/clawnetd
mkdir -p /data/caddy
mkdir -p /opt/clawnet
mkdir -p /var/log/caddy

# Set permissions
chmod 750 /data/reth
chmod 750 /data/clawnetd
chmod 750 /data/caddy
chmod 750 /opt/clawnet

info "Data directories created:"
info "  /data/reth       — Reth chain data"
info "  /data/clawnetd   — clawnetd protocol data"
info "  /data/caddy      — Caddy TLS certs + config"
info "  /opt/clawnet     — Docker Compose files + scripts"
info "  /var/log/caddy   — Caddy access logs"
echo ""

# ── Step 4: Firewall (UFW) ───────────────────────────────────────────────────
info "Step 4/7: Configuring firewall..."

if command -v ufw &>/dev/null; then
  # Default deny incoming
  ufw default deny incoming
  ufw default allow outgoing

  # SSH (IMPORTANT: don't lock yourself out)
  ufw allow 22/tcp comment "SSH"

  # Reth P2P (devp2p)
  ufw allow 30303/tcp comment "Reth P2P TCP"
  ufw allow 30303/udp comment "Reth P2P UDP (discovery)"

  # clawnetd libp2p
  ufw allow 9527/tcp comment "clawnetd P2P"

  # HTTPS (Server A only — uncomment on Server B/C if not needed)
  ufw allow 443/tcp comment "HTTPS (Caddy)"

  # HTTP for Caddy ACME challenges
  ufw allow 80/tcp comment "HTTP (ACME)"

  # Enable UFW (non-interactive)
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
# Maximum number of open file descriptors
fs.file-max = 65535

# TCP connection tuning
net.core.somaxconn = 4096
net.core.netdev_max_backlog = 4096
net.ipv4.tcp_max_syn_backlog = 4096

# Connection tracking
net.netfilter.nf_conntrack_max = 131072

# Reuse TIME_WAIT sockets
net.ipv4.tcp_tw_reuse = 1

# TCP keepalive (detect dead peers faster)
net.ipv4.tcp_keepalive_time = 120
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 3

# Buffer sizes
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
EOF

sysctl -p "$SYSCTL_CONF"

# Increase file descriptor limits
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

# Set ownership
chown -R clawnet:clawnet /data/reth /data/clawnetd /data/caddy /opt/clawnet

echo ""

# ── Step 7: Install Foundry (cast) ───────────────────────────────────────────
info "Step 7/7: Installing Foundry (cast CLI for chain interaction)..."

if command -v cast &>/dev/null; then
  warn "Foundry already installed: $(cast --version 2>/dev/null || echo 'unknown')"
else
  # Install Foundry via foundryup
  curl -L https://foundry.paradigm.xyz | bash

  # Source the foundry env
  export PATH="$HOME/.foundry/bin:$PATH"

  # Run foundryup to install binaries
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
echo -e "${GREEN}  ClawNet Server Setup Complete!${NC}"
echo "============================================================"
echo ""
echo "  Next steps:"
echo "  1. Copy deployment files to /opt/clawnet/"
echo "     scp infra/chain-testnet/* user@server:/opt/clawnet/"
echo ""
echo "  2. Create .env from template:"
echo "     cp /opt/clawnet/.env.example /opt/clawnet/.env"
echo "     nano /opt/clawnet/.env"
echo ""
echo "  3. Generate validator key:"
echo "     cast wallet new"
echo ""
echo "  4. Initialize & start:"
echo "     Follow the guide in infra/README.md"
echo ""
echo "  5. Verify with health check:"
echo "     /opt/clawnet/health-check.sh"
echo ""
echo "============================================================"
