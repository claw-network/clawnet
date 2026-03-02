#!/usr/bin/env bash
# ============================================================================
# ClawNet Chain Server — Daily Security Audit & Auto-Remediation
# ============================================================================
# Adapted from infra/mail/security-audit.sh for Geth chain servers.
# Performs strict security checks and auto-fixes known issues.
#
# Usage (local — runs checks via SSH on all 3 servers):
#   ./security-audit.sh                    # full audit + auto-fix
#   ./security-audit.sh --check-only       # audit only, no fixes
#   ./security-audit.sh --verbose          # extra diagnostic output
#   ./security-audit.sh --server 1         # audit only Node 1
#
# Usage (on server — deployed by deploy.sh):
#   /opt/clawnet/security-audit.sh         # direct execution
#
# Cron (server-side, installed automatically):
#   0 4 * * * /opt/clawnet/security-audit.sh --cron 2>&1 | logger -t clawnet-audit
#
# Exit codes:
#   0 — all checks passed
#   1 — issues found and fixed (or --check-only with findings)
#   2 — critical issues that could not be auto-fixed
# ============================================================================
set -uo pipefail

# ─────────────────────────── Configuration ───────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Server IPs (set via env or secrets.env before mainnet launch)
SERVER_1="${CLAWNET_SERVER_1:?Set CLAWNET_SERVER_1 or source secrets.env}"
SERVER_2="${CLAWNET_SERVER_2:?Set CLAWNET_SERVER_2 or source secrets.env}"
SERVER_3="${CLAWNET_SERVER_3:?Set CLAWNET_SERVER_3 or source secrets.env}"
SERVER_4="${CLAWNET_SERVER_4:?Set CLAWNET_SERVER_4 or source secrets.env}"
SERVER_5="${CLAWNET_SERVER_5:?Set CLAWNET_SERVER_5 or source secrets.env}"
SSH_KEY="${CLAWNET_SSH_KEY:-$HOME/.ssh/id_ed25519_clawnet}"
SSH_USER="${CLAWNET_SSH_USER:-root}"
SSH_PORT="${CLAWNET_SSH_PORT:-22}"

# Detect execution mode
if [[ -d /opt/clawnet/chain-data ]] && [[ -f /opt/clawnet/config/genesis.json ]]; then
  MODE="server"
else
  MODE="local"
fi

if [[ "$MODE" == "server" ]]; then
  AUDIT_LOG="${AUDIT_LOG:-/var/log/clawnet-audit.log}"
else
  AUDIT_LOG="${AUDIT_LOG:-/tmp/clawnet-chain-audit.log}"
fi

CHECK_ONLY=false
VERBOSE=false
CRON_MODE=false
TARGET_SERVER=""  # empty = all servers
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Allowed SSH public key fingerprints (authorized keys comments)
ALLOWED_SSH_KEYS="11701@Weibo-Home clawnet-server-admin"

# Expected listening ports for chain servers
EXPECTED_PORTS="22 80 443 8545 9527 9528 30303"

# Email reporting (SMTPS with authentication)
REPORT_EMAIL="${CLAWNET_REPORT_EMAIL:-noreply@clawnetd.com}"
SMTP_HOST="${CLAWNET_SMTP_HOST:-mail.clawnetd.com}"
SMTP_PORT="${CLAWNET_SMTP_PORT:-465}"
SMTP_FROM="${CLAWNET_SMTP_FROM:-security-audit@clawnetd.com}"
SMTP_USER="${CLAWNET_SMTP_USER:-security-audit@clawnetd.com}"
SMTP_PASS="${CLAWNET_SMTP_PASS:-}"
EMAIL_ON_SUCCESS="${CLAWNET_EMAIL_ON_SUCCESS:-false}"  # only email on issues by default

# Counters
PASS=0
WARN=0
FAIL=0
FIXED=0
CRITICAL=0

# ─────────────────────────── Argument Parsing ────────────────────────────────

for arg in "$@"; do
  case "$arg" in
    --check-only)  CHECK_ONLY=true ;;
    --verbose)     VERBOSE=true ;;
    --cron)        CRON_MODE=true ;;
    --test-email)  TEST_EMAIL=true ;;
    --server)      shift_next=true ;;
    1|2|3|4|5)
      if [[ "${shift_next:-}" == true ]]; then
        TARGET_SERVER="$arg"
        shift_next=false
      fi
      ;;
    -h|--help)
      head -25 "$0" | grep '^#' | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

# ─────────────────────────── Output Helpers ──────────────────────────────────

_log() { echo "$TIMESTAMP $*" >> "$AUDIT_LOG" 2>/dev/null; }

pass() {
  ((PASS++))
  if [[ "$CRON_MODE" == false ]]; then
    echo -e "  \033[1;32m✓ PASS\033[0m  $*"
  fi
  _log "PASS  $*"
}

warn() {
  ((WARN++))
  echo -e "  \033[1;33m⚠ WARN\033[0m  $*"
  _log "WARN  $*"
}

fail() {
  ((FAIL++))
  echo -e "  \033[1;31m✗ FAIL\033[0m  $*"
  _log "FAIL  $*"
}

crit() {
  ((CRITICAL++))
  echo -e "  \033[1;31;7m✗ CRIT\033[0m  $*"
  _log "CRIT  $*"
}

fixed() {
  ((FIXED++))
  echo -e "  \033[1;36m⟳ FIX \033[0m  $*"
  _log "FIXED $*"
}

info() {
  if [[ "$VERBOSE" == true ]] || [[ "$CRON_MODE" == false ]]; then
    echo -e "  \033[0;37m  info\033[0m  $*"
  fi
}

section() {
  if [[ "$CRON_MODE" == false ]]; then
    echo ""
    echo -e "\033[1;34m── $* ──\033[0m"
  fi
  _log "--- $* ---"
}

# ─────────────────────────── Email Reporting ─────────────────────────────────

test_email() {
  echo "Sending SMTP test email to ${REPORT_EMAIL} via smtps://${SMTP_HOST}:${SMTP_PORT} ..."
  local test_body
  test_body=$(cat <<MAILEOF
From: ClawNet Security Audit <${SMTP_FROM}>
To: ${REPORT_EMAIL}
Subject: [ClawNet Mainnet] SMTP Test — $(hostname) — ${TIMESTAMP}
Date: $(date -R 2>/dev/null || date -u)
Content-Type: text/plain; charset=utf-8
MIME-Version: 1.0
X-Mailer: clawnet-security-audit

This is a test email from ClawNet Mainnet security-audit.sh

Host:      $(hostname 2>/dev/null || echo unknown)
Timestamp: ${TIMESTAMP}
SMTP Host: ${SMTP_HOST}:${SMTP_PORT}
SMTP User: ${SMTP_USER}
Recipient: ${REPORT_EMAIL}

If you received this, SMTP is configured correctly.
MAILEOF
)

  local curl_args=(
    --verbose --max-time 30
    --url "smtps://${SMTP_HOST}:${SMTP_PORT}"
    --ssl-reqd
    --mail-from "${SMTP_FROM}"
    --mail-rcpt "${REPORT_EMAIL}"
    -T -
  )
  if [[ -n "${SMTP_PASS}" ]]; then
    curl_args+=(--user "${SMTP_USER}:${SMTP_PASS}")
  fi

  if curl "${curl_args[@]}" <<< "$test_body" 2>&1; then
    echo "✓ Test email sent successfully to ${REPORT_EMAIL}"
  else
    echo "✗ Failed to send test email (exit code: $?)"
    exit 1
  fi
  exit 0
}

# Handle --test-email before main()
if [[ "${TEST_EMAIL:-}" == true ]]; then
  test_email
fi

send_report_email() {
  local subject="$1"
  local body="$2"

  # Only attempt email if curl is available and SMTP host is reachable
  if ! command -v curl >/dev/null 2>&1; then
    _log "EMAIL: curl not found, skipping email report"
    return 0
  fi

  local hostname
  hostname=$(hostname 2>/dev/null || echo "unknown")
  local mail_body
  mail_body=$(cat <<MAILEOF
From: ClawNet Security Audit <${SMTP_FROM}>
To: ${REPORT_EMAIL}
Subject: ${subject}
Date: $(date -R 2>/dev/null || date -u)
Content-Type: text/plain; charset=utf-8
MIME-Version: 1.0
X-Mailer: clawnet-security-audit

${body}

--
ClawNet Security Audit
Host: ${hostname}
Timestamp: ${TIMESTAMP}
Log: ${AUDIT_LOG}
MAILEOF
)

  # Build curl SMTP command (SMTPS with auth)
  local curl_args=(
    --silent --max-time 30
    --url "smtps://${SMTP_HOST}:${SMTP_PORT}"
    --ssl-reqd
    --mail-from "${SMTP_FROM}"
    --mail-rcpt "${REPORT_EMAIL}"
    -T -
  )
  if [[ -n "${SMTP_PASS}" ]]; then
    curl_args+=(--user "${SMTP_USER}:${SMTP_PASS}")
  fi

  if curl "${curl_args[@]}" <<< "$mail_body" 2>/dev/null; then
    _log "EMAIL: report sent to ${REPORT_EMAIL}"
  else
    _log "EMAIL: failed to send report to ${REPORT_EMAIL} via smtps://${SMTP_HOST}:${SMTP_PORT}"
  fi
}

# ─────────────────────────── Remote Execution ────────────────────────────────

run() {
  if [[ "$MODE" == "server" ]]; then
    eval "$@" 2>/dev/null
  else
    ssh -n -p "$SSH_PORT" -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "${SSH_USER}@${CURRENT_HOST}" "$@" 2>/dev/null
  fi
}

run_fix() {
  if [[ "$CHECK_ONLY" == true ]]; then
    info "Would fix: $*"
    return 1
  fi
  run "$@"
}

# ═════════════════════════════════════════════════════════════════════════════
# CHECK 1: SSH Configuration
# ═════════════════════════════════════════════════════════════════════════════

check_ssh() {
  section "1. SSH Configuration"

  local sshd_out
  sshd_out=$(run "sshd -T 2>/dev/null")

  # 1a. Password authentication must be disabled
  local pw_auth
  pw_auth=$(echo "$sshd_out" | grep -i '^passwordauthentication' | awk '{print $2}')
  if [[ "$pw_auth" == "no" ]]; then
    pass "Password authentication disabled"
  else
    fail "Password authentication is ENABLED — brute force risk"
    if run_fix "sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl restart ssh"; then
      fixed "Disabled password authentication, restarted sshd"
    fi
  fi

  # 1b. MaxAuthTries must be <= 3
  local max_auth
  max_auth=$(echo "$sshd_out" | grep -i '^maxauthtries' | awk '{print $2}')
  if [[ -n "$max_auth" ]] && [[ "$max_auth" -le 3 ]]; then
    pass "MaxAuthTries = $max_auth"
  else
    warn "MaxAuthTries = ${max_auth:-unlimited} (should be ≤ 3)"
    if run_fix "mkdir -p /etc/ssh/sshd_config.d && cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'SSHEOF'
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
PermitRootLogin prohibit-password
ClientAliveInterval 300
ClientAliveCountMax 2
Banner none
SSHEOF
systemctl restart ssh"; then
      fixed "Applied SSH hardening config"
    fi
  fi

  # 1c. PermitRootLogin must not be "yes"
  local root_login
  root_login=$(echo "$sshd_out" | grep -i '^permitrootlogin' | awk '{print $2}')
  if [[ "$root_login" != "yes" ]]; then
    pass "PermitRootLogin = $root_login"
  else
    crit "PermitRootLogin = yes — unrestricted root login!"
    if run_fix "sed -i 's/^PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config && systemctl restart ssh"; then
      fixed "Set PermitRootLogin to prohibit-password"
    fi
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# CHECK 2: Fail2ban
# ═════════════════════════════════════════════════════════════════════════════

check_fail2ban() {
  section "2. Host Fail2ban"

  local f2b_active
  f2b_active=$(run "systemctl is-active fail2ban 2>/dev/null")
  if [[ "$f2b_active" == "active" ]]; then
    pass "Fail2ban service running"
  else
    crit "Fail2ban service is NOT running — SSH unprotected!"
    if run_fix "systemctl start fail2ban && systemctl enable fail2ban"; then
      fixed "Started and enabled fail2ban"
    fi
  fi

  local sshd_jail
  sshd_jail=$(run "fail2ban-client status sshd 2>/dev/null")
  if echo "$sshd_jail" | grep -q "Currently banned"; then
    local banned
    banned=$(echo "$sshd_jail" | grep "Currently banned" | awk '{print $NF}')
    pass "sshd jail active, currently banned: $banned"
  else
    fail "sshd jail not active"
    if run_fix "fail2ban-client reload sshd 2>/dev/null || systemctl restart fail2ban"; then
      fixed "Reloaded sshd jail"
    fi
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# CHECK 3: UFW Firewall
# ═════════════════════════════════════════════════════════════════════════════

check_firewall() {
  section "3. Firewall (UFW)"

  local ufw_status
  ufw_status=$(run "ufw status 2>/dev/null" | head -1)
  if echo "$ufw_status" | grep -q "active"; then
    pass "UFW firewall active"
  else
    crit "UFW firewall is INACTIVE — server fully exposed!"
    if run_fix "echo 'y' | ufw enable"; then
      fixed "Re-enabled UFW firewall"
    fi
  fi

  local default_policy
  default_policy=$(run "ufw status verbose 2>/dev/null" | grep "Default:")
  if echo "$default_policy" | grep -q "deny (incoming)"; then
    pass "Default incoming policy: deny"
  else
    fail "Default incoming policy is NOT deny"
    if run_fix "ufw default deny incoming && ufw reload"; then
      fixed "Set default incoming to deny"
    fi
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# CHECK 4: Unauthorized SSH Keys
# ═════════════════════════════════════════════════════════════════════════════

check_authorized_keys() {
  section "4. SSH Authorized Keys"

  local keys
  keys=$(run "cat /root/.ssh/authorized_keys 2>/dev/null")
  local num_keys
  num_keys=$(echo "$keys" | grep -c "ssh-" || echo 0)

  if [[ "$num_keys" -le 2 ]]; then
    pass "authorized_keys has $num_keys key(s)"
  else
    crit "authorized_keys has $num_keys keys — possible unauthorized access!"
  fi

  # Check each key has a recognized comment
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^# ]] && continue
    local comment
    comment=$(echo "$line" | awk '{print $3}')
    local found=false
    for allowed in $ALLOWED_SSH_KEYS; do
      if [[ "$comment" == "$allowed" ]]; then
        found=true
        break
      fi
    done
    if [[ "$found" == true ]]; then
      pass "Key: $comment"
    else
      crit "UNKNOWN SSH key: ${comment:-<no comment>}"
      info "  → $(echo "$line" | cut -c1-80)..."
    fi
  done <<< "$keys"
}

# ═════════════════════════════════════════════════════════════════════════════
# CHECK 5: Suspicious Processes (Mining, Reverse Shells)
# ═════════════════════════════════════════════════════════════════════════════

check_processes() {
  section "5. Suspicious Processes"

  local miners="xmrig|xmr-stak|minerd|cpuminer|kdevtmpfsi|kinsing|sshMiner|dbused|ld-linux|cryptonight|stratum|nicehash|systemd-bench"
  local found_miners
  found_miners=$(run "ps aux 2>/dev/null" | grep -iE "$miners" | grep -v "grep\|security-audit")
  if [[ -z "$found_miners" ]]; then
    pass "No known crypto miner processes"
  else
    crit "POSSIBLE CRYPTO MINER DETECTED!"
    echo "$found_miners" | while IFS= read -r line; do info "  → $line"; done
    if [[ "$CHECK_ONLY" == false ]]; then
      local pids
      pids=$(echo "$found_miners" | awk '{print $2}' | tr '\n' ' ')
      run_fix "kill -9 $pids"
      fixed "Killed suspicious PIDs: $pids"
    fi
  fi

  # Check for hidden miner directories
  local hidden_dirs
  hidden_dirs=$(run "ls -d /root/.system /root/.system-cache /root/.xmrig /root/.cache/xmrig /etc/xmrig-restore 2>/dev/null")
  if [[ -z "$hidden_dirs" ]]; then
    pass "No hidden miner directories"
  else
    crit "Hidden miner directories found: $hidden_dirs"
    if run_fix "rm -rf /root/.system /root/.system-cache /root/.xmrig /root/.cache/xmrig /etc/xmrig-restore 2>/dev/null"; then
      fixed "Removed hidden miner directories"
    fi
  fi

  # CPU usage anomaly (single process > 80%)
  local high_cpu
  high_cpu=$(run "ps aux --sort=-%cpu 2>/dev/null" | awk 'NR>1 && $3 > 80 {print $2, $3, $11}' | grep -vE "ps|top|geth")
  if [[ -z "$high_cpu" ]]; then
    pass "No abnormal CPU usage"
  else
    warn "High CPU process: $high_cpu"
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# CHECK 6: Cron Jobs
# ═════════════════════════════════════════════════════════════════════════════

check_cron() {
  section "6. Cron Jobs"

  local root_cron
  root_cron=$(run "crontab -l 2>/dev/null" | grep -v '^#' | grep -v '^$')
  if [[ -z "$root_cron" ]]; then
    pass "Root crontab is clean (will have audit cron after hardening)"
  else
    local suspicious
    suspicious=$(echo "$root_cron" | grep -iE "curl.*http|wget.*http|bash -c|python.*http|/tmp/|/dev/shm|bench|xmrig" | grep -v "security-audit\|clawnet-audit")
    if [[ -n "$suspicious" ]]; then
      crit "Suspicious cron entry found!"
      info "  → $suspicious"
      if run_fix "crontab -r && (echo '0 4 * * * /opt/clawnet/security-audit.sh --cron 2>&1 | logger -t clawnet-audit') | crontab -"; then
        fixed "Replaced crontab with only security audit entry"
      fi
    else
      pass "Root crontab entries look legitimate"
      if [[ "$VERBOSE" == true ]]; then
        echo "$root_cron" | while IFS= read -r line; do info "  → $line"; done
      fi
    fi
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# CHECK 7: Kernel & Network Hardening
# ═════════════════════════════════════════════════════════════════════════════

check_sysctl() {
  section "7. Kernel & Network Hardening"

  local sysctl_checks="net.ipv4.tcp_syncookies=1
net.ipv4.conf.all.accept_redirects=0
net.ipv4.conf.all.send_redirects=0
net.ipv4.conf.all.rp_filter=1
net.ipv4.icmp_echo_ignore_broadcasts=1
net.ipv4.conf.all.accept_source_route=0
kernel.randomize_va_space=2
kernel.dmesg_restrict=1
kernel.kptr_restrict=2
fs.suid_dumpable=0"

  local drift=false
  while IFS='=' read -r key expected_val; do
    [[ -z "$key" ]] && continue
    local actual
    actual=$(run "sysctl -n $key 2>/dev/null")
    if [[ "$actual" == "$expected_val" ]]; then
      pass "$key = $actual"
    else
      fail "$key = $actual (expected $expected_val)"
      drift=true
    fi
  done <<< "$sysctl_checks"

  if [[ "$drift" == true ]]; then
    if run_fix "sysctl -p /etc/sysctl.d/99-clawnet-hardening.conf 2>/dev/null"; then
      fixed "Re-applied sysctl hardening"
    fi
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# CHECK 8: Docker Security
# ═════════════════════════════════════════════════════════════════════════════

check_docker() {
  section "8. Docker Security"

  local docker_active
  docker_active=$(run "systemctl is-active docker 2>/dev/null")
  if [[ "$docker_active" == "active" ]]; then
    pass "Docker daemon running"
  else
    crit "Docker daemon is NOT running!"
    if run_fix "systemctl start docker"; then
      fixed "Started Docker daemon"
    fi
  fi

  # Log rotation
  local log_max
  log_max=$(run "cat /etc/docker/daemon.json 2>/dev/null" | grep -o '"max-size"[^,]*' | head -1)
  if [[ -n "$log_max" ]]; then
    pass "Docker log rotation configured: $log_max"
  else
    fail "Docker log rotation NOT configured — disk fill risk"
    if run_fix "cat > /etc/docker/daemon.json <<'DJSON'
{
  \"log-driver\": \"json-file\",
  \"log-opts\": { \"max-size\": \"50m\", \"max-file\": \"3\" },
  \"no-new-privileges\": true,
  \"live-restore\": true
}
DJSON"; then
      fixed "Created Docker daemon.json with log rotation"
    fi
  fi

  # Geth container health
  local geth_status
  geth_status=$(run "docker inspect --format '{{.State.Status}}' clawnet-geth 2>/dev/null")
  if [[ "$geth_status" == "running" ]]; then
    pass "Container clawnet-geth: running"
    # Check restart count
    local restarts
    restarts=$(run "docker inspect --format '{{.RestartCount}}' clawnet-geth 2>/dev/null")
    if [[ -n "$restarts" ]] && [[ "$restarts" -gt 10 ]]; then
      warn "clawnet-geth restart count: $restarts (possible crash loop)"
    fi
  else
    crit "Container clawnet-geth: ${geth_status:-not found}"
  fi

  # Check for unknown containers
  local running_containers
  running_containers=$(run "docker ps --format '{{.Names}}' 2>/dev/null" | sort)
  local expected_containers="clawnet-geth"
  while IFS= read -r c; do
    if [[ -n "$c" ]] && ! echo "$expected_containers" | grep -qw "$c"; then
      crit "Unknown container running: $c"
      info "  → Investigate: docker inspect $c"
    fi
  done <<< "$running_containers"
}

# ═════════════════════════════════════════════════════════════════════════════
# CHECK 9: Chain Data Integrity
# ═════════════════════════════════════════════════════════════════════════════

check_chain_data() {
  section "9. Chain Data Integrity"

  # Config files must exist
  if run "test -f /opt/clawnet/config/password.txt"; then
    pass "password.txt exists"
  else
    crit "password.txt MISSING — Geth will crash on restart!"
  fi

  if run "test -f /opt/clawnet/config/genesis.json"; then
    pass "genesis.json exists"
  else
    crit "genesis.json MISSING — cannot re-initialize chain!"
  fi

  # Chain data dir must have content
  local chaindata_size
  chaindata_size=$(run "du -sm /opt/clawnet/chain-data/ 2>/dev/null | awk '{print \$1}'")
  if [[ -n "$chaindata_size" ]] && [[ "$chaindata_size" -gt 1 ]]; then
    pass "chain-data size: ${chaindata_size}MB"
  else
    crit "chain-data is empty or missing (${chaindata_size:-0}MB) — chain is wiped!"
  fi

  # Keystore must have validator key
  local keystore_count
  keystore_count=$(run "ls /opt/clawnet/chain-data/keystore/ 2>/dev/null | wc -l")
  if [[ -n "$keystore_count" ]] && [[ "$keystore_count" -gt 0 ]]; then
    pass "Keystore has $keystore_count key file(s)"
  else
    crit "Keystore is EMPTY — validator key missing!"
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# CHECK 10: ClawNetd Service
# ═════════════════════════════════════════════════════════════════════════════

check_clawnetd() {
  section "10. ClawNetd Service"

  local clawnetd_active
  clawnetd_active=$(run "systemctl is-active clawnetd 2>/dev/null")
  if [[ "$clawnetd_active" == "active" ]]; then
    pass "clawnetd service running"
  else
    fail "clawnetd service: ${clawnetd_active:-not found}"
    if run_fix "systemctl start clawnetd"; then
      fixed "Started clawnetd service"
    fi
  fi

  # Check REST API responds
  local api_status
  api_status=$(run "curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:9528/api/health 2>/dev/null")
  if [[ "$api_status" == "200" ]]; then
    pass "ClawNetd REST API healthy (port 9528)"
  else
    warn "ClawNetd REST API: HTTP $api_status (expected 200)"
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# CHECK 11: Disk Space
# ═════════════════════════════════════════════════════════════════════════════

check_disk() {
  section "11. Disk Space"

  local usage
  usage=$(run "df -h / 2>/dev/null" | awk 'NR==2 {print $5}' | tr -d '%')
  if [[ -z "$usage" ]]; then
    warn "Could not check disk usage"
    return
  fi

  if [[ "$usage" -lt 70 ]]; then
    pass "Disk usage: ${usage}%"
  elif [[ "$usage" -lt 85 ]]; then
    warn "Disk usage: ${usage}% — monitor closely"
  elif [[ "$usage" -lt 95 ]]; then
    fail "Disk usage: ${usage}% — cleanup required"
    if run_fix "docker system prune -f 2>/dev/null && journalctl --vacuum-time=7d 2>/dev/null"; then
      fixed "Cleaned Docker cache and old journal logs"
    fi
  else
    crit "Disk usage: ${usage}% — CRITICAL"
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# CHECK 12: SUID/SGID Binaries
# ═════════════════════════════════════════════════════════════════════════════

check_suid() {
  section "12. SUID/SGID Binaries"

  local known_suid="/usr/bin/sudo /usr/bin/su /usr/bin/passwd /usr/bin/chsh /usr/bin/chfn /usr/bin/newgrp /usr/bin/gpasswd /usr/bin/mount /usr/bin/umount /usr/bin/pkexec /usr/bin/fusermount3 /usr/lib/openssh/ssh-keysign /usr/lib/dbus-1.0/dbus-daemon-launch-helper /usr/lib/polkit-1/polkit-agent-helper-1 /usr/bin/crontab"

  local new_suids
  new_suids=$(run "find /usr /bin /sbin -perm -4000 -type f 2>/dev/null" | sort)

  local unexpected=""
  while IFS= read -r binary; do
    if [[ -n "$binary" ]] && ! echo "$known_suid" | grep -qF "$binary"; then
      if ! echo "$binary" | grep -q "snap"; then
        unexpected="$unexpected $binary"
      fi
    fi
  done <<< "$new_suids"

  if [[ -z "${unexpected// }" ]]; then
    pass "No unexpected SUID binaries"
  else
    crit "Unexpected SUID binaries found:$unexpected"
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# CHECK 13: Listening Ports
# ═════════════════════════════════════════════════════════════════════════════

check_ports() {
  section "13. Listening Ports"

  local public_ports
  public_ports=$(run "ss -tlnp 2>/dev/null" | grep -v "127.0.0" | grep "LISTEN" | awk '{print \$4}' | grep -oE '[0-9]+$' | sort -un)

  while IFS= read -r port; do
    if [[ -n "$port" ]] && ! echo "$EXPECTED_PORTS" | grep -qw "$port"; then
      local proc
      proc=$(run "ss -tlnp 2>/dev/null" | grep \":${port} \" | head -1)
      crit "Unexpected listening port: $port"
      info "  → $proc"
    fi
  done <<< "$public_ports"

  for port in 22 30303 9528; do
    if echo "$public_ports" | grep -qw "$port"; then
      pass "Port $port listening"
    else
      fail "Port $port NOT listening"
    fi
  done
}

# ═════════════════════════════════════════════════════════════════════════════
# CHECK 14: File Integrity
# ═════════════════════════════════════════════════════════════════════════════

check_file_integrity() {
  section "14. File Integrity"

  local shadow_perms
  shadow_perms=$(run "stat -c '%a' /etc/shadow 2>/dev/null")
  if [[ "$shadow_perms" == "640" ]] || [[ "$shadow_perms" == "600" ]]; then
    pass "/etc/shadow permissions: $shadow_perms"
  else
    fail "/etc/shadow permissions: $shadow_perms (expected 640)"
    if run_fix "chmod 640 /etc/shadow"; then
      fixed "Fixed /etc/shadow permissions"
    fi
  fi

  # Temp directories should not have executables
  local tmp_execs
  tmp_execs=$(run "find /tmp /dev/shm /var/tmp -type f -executable 2>/dev/null | head -10")
  if [[ -z "$tmp_execs" ]]; then
    pass "No executables in /tmp, /dev/shm, /var/tmp"
  else
    crit "Executable files found in temp directories!"
    echo "$tmp_execs" | while IFS= read -r f; do info "  → $f"; done
    if run_fix "find /tmp /dev/shm /var/tmp -type f -executable -delete 2>/dev/null"; then
      fixed "Removed executable files from temp directories"
    fi
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# CHECK 15: Authentication Analysis
# ═════════════════════════════════════════════════════════════════════════════

check_auth_log() {
  section "15. Authentication Analysis"

  local fail_count
  fail_count=$(run "journalctl -u ssh -u sshd --since '24 hours ago' --no-pager 2>/dev/null | grep -c 'Invalid user\|Failed password'" || echo 0)
  if [[ "$fail_count" -lt 100 ]]; then
    pass "SSH auth failures (24h): $fail_count"
  elif [[ "$fail_count" -lt 500 ]]; then
    warn "Elevated SSH auth failures (24h): $fail_count"
  else
    fail "High SSH auth failures (24h): $fail_count — heavy brute force"
  fi

  local pw_logins
  pw_logins=$(run "grep 'Accepted password' /var/log/auth.log 2>/dev/null" | tail -3)
  if [[ -z "$pw_logins" ]]; then
    pass "No password-based SSH logins"
  else
    crit "Password-based SSH logins detected!"
    echo "$pw_logins" | while IFS= read -r line; do info "  → $line"; done
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# CHECK 16: Software Updates
# ═════════════════════════════════════════════════════════════════════════════

check_updates() {
  section "16. Software Updates"

  local uu_status
  uu_status=$(run "systemctl is-enabled unattended-upgrades 2>/dev/null")
  if [[ "$uu_status" == "enabled" ]]; then
    pass "Unattended security upgrades enabled"
  else
    fail "Unattended upgrades NOT enabled"
    if run_fix "apt-get install -y -qq unattended-upgrades 2>/dev/null && systemctl enable unattended-upgrades && systemctl start unattended-upgrades"; then
      fixed "Enabled unattended-upgrades"
    fi
  fi
}

# ═════════════════════════════════════════════════════════════════════════════
# MAIN — Audit one server
# ═════════════════════════════════════════════════════════════════════════════

audit_server() {
  local host="$1"
  local label="$2"

  CURRENT_HOST="$host"

  if [[ "$CRON_MODE" == false ]]; then
    echo ""
    echo -e "\033[1;35m══════════════════════════════════════════════════\033[0m"
    echo -e "\033[1;35m   Auditing: $label ($host)\033[0m"
    echo -e "\033[1;35m══════════════════════════════════════════════════\033[0m"
  fi

  # Verify connectivity (local mode only)
  if [[ "$MODE" == "local" ]]; then
    if ! run "echo ok" | grep -q "ok"; then
      crit "Cannot connect to $label ($host)"
      return
    fi
  fi

  check_ssh
  check_fail2ban
  check_firewall
  check_authorized_keys
  check_processes
  check_cron
  check_sysctl
  check_docker
  check_chain_data
  check_clawnetd
  check_disk
  check_suid
  check_ports
  check_file_integrity
  check_auth_log
  check_updates
}

main() {
  if [[ "$CRON_MODE" == false ]]; then
    echo ""
    echo -e "\033[1;34m╔══════════════════════════════════════════════════════════╗\033[0m"
    echo -e "\033[1;34m║   ClawNet Chain — Security Audit & Remediation          ║\033[0m"
    echo -e "\033[1;34m╚══════════════════════════════════════════════════════════╝\033[0m"
    echo -e "  Mode: ${MODE} | Time: ${TIMESTAMP}"
    if [[ "$CHECK_ONLY" == true ]]; then
      echo -e "  \033[1;33mCHECK-ONLY mode — no fixes will be applied\033[0m"
    fi
  fi

  _log "=== Audit started (mode=$MODE, check_only=$CHECK_ONLY) ==="

  if [[ "$MODE" == "server" ]]; then
    # Running directly on server
    CURRENT_HOST="localhost"
    check_ssh
    check_fail2ban
    check_firewall
    check_authorized_keys
    check_processes
    check_cron
    check_sysctl
    check_docker
    check_chain_data
    check_clawnetd
    check_disk
    check_suid
    check_ports
    check_file_integrity
    check_auth_log
    check_updates
  else
    # Running locally — audit selected or all servers
    case "${TARGET_SERVER}" in
      1) audit_server "$SERVER_1" "Node 1" ;;
      2) audit_server "$SERVER_2" "Node 2" ;;
      3) audit_server "$SERVER_3" "Node 3" ;;
      4) audit_server "$SERVER_4" "Node 4" ;;
      5) audit_server "$SERVER_5" "Node 5" ;;
      *)
        audit_server "$SERVER_1" "Node 1"
        audit_server "$SERVER_2" "Node 2"
        audit_server "$SERVER_3" "Node 3"
        audit_server "$SERVER_4" "Node 4"
        audit_server "$SERVER_5" "Node 5"
        ;;
    esac
  fi

  # Summary
  local total=$((PASS + WARN + FAIL + CRITICAL))

  if [[ "$CRON_MODE" == false ]]; then
    echo ""
    echo -e "\033[1;34m── Summary ──\033[0m"
    echo -e "  Total checks: $total"
    echo -e "  \033[1;32m✓ Passed:  $PASS\033[0m"
    [[ "$WARN" -gt 0 ]] && echo -e "  \033[1;33m⚠ Warnings: $WARN\033[0m"
    [[ "$FAIL" -gt 0 ]] && echo -e "  \033[1;31m✗ Failed:  $FAIL\033[0m"
    [[ "$CRITICAL" -gt 0 ]] && echo -e "  \033[1;31;7m✗ Critical: $CRITICAL\033[0m"
    [[ "$FIXED" -gt 0 ]] && echo -e "  \033[1;36m⟳ Fixed:   $FIXED\033[0m"
    echo ""
  fi

  _log "=== Audit complete: pass=$PASS warn=$WARN fail=$FAIL crit=$CRITICAL fixed=$FIXED ==="

  # Email report when issues found (or always if EMAIL_ON_SUCCESS=true)
  local has_issues=false
  [[ "$WARN" -gt 0 || "$FAIL" -gt 0 || "$CRITICAL" -gt 0 ]] && has_issues=true

  if [[ "$has_issues" == true ]] || [[ "$EMAIL_ON_SUCCESS" == true ]]; then
    local level="OK"
    [[ "$WARN" -gt 0 ]]     && level="WARNING"
    [[ "$FAIL" -gt 0 ]]     && level="FAILED"
    [[ "$CRITICAL" -gt 0 ]] && level="CRITICAL"

    local email_subject="[ClawNet Mainnet] Security Audit ${level} — $(hostname) — ${TIMESTAMP}"
    local email_body
    email_body=$(printf "ClawNet Mainnet Security Audit Report\n\n"
    printf "Status:   %s\n" "$level"
    printf "Passed:   %d\n" "$PASS"
    printf "Warnings: %d\n" "$WARN"
    printf "Failed:   %d\n" "$FAIL"
    printf "Critical: %d\n" "$CRITICAL"
    printf "Fixed:    %d\n" "$FIXED"
    printf "Total:    %d\n\n" "$total"
    printf "Full log: %s\n" "$AUDIT_LOG"
    if [[ -f "$AUDIT_LOG" ]]; then
      printf "\n--- Recent log entries ---\n"
      tail -50 "$AUDIT_LOG" 2>/dev/null
    fi)

    send_report_email "$email_subject" "$email_body"
  fi

  if [[ "$CRITICAL" -gt 0 ]] && [[ "$FIXED" -lt "$CRITICAL" ]]; then
    exit 2
  elif [[ "$FAIL" -gt 0 ]] || [[ "$WARN" -gt 0 ]]; then
    exit 1
  fi
  exit 0
}

main
