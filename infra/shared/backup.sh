#!/usr/bin/env bash
# ClawNet daily backup — works for both testnet and mainnet
# Backs up: SQLite databases (hot backup) + Besu chain-data (tar)
# Retention: configurable via RETAIN_DAYS (default 7)
#
# All paths are configurable via environment variables (set before invoking):
#   BACKUP_DIR   — where archives go       (default: /backup/clawnet)
#   DATA_DIR     — clawnetd data directory  (default: /opt/clawnet/clawnetd-data)
#   CHAIN_DIR    — Besu chain-data          (default: /opt/clawnet/chain-data)
#   RETAIN_DAYS  — days to keep old backups (default: 7)
#   LOG          — log file path            (default: /var/log/clawnet-backup.log)
#
# Deployed automatically by deploy.sh via setup_backup_cron().

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backup/clawnet}"
DATA_DIR="${DATA_DIR:-/opt/clawnet/clawnetd-data}"
CHAIN_DIR="${CHAIN_DIR:-/opt/clawnet/chain-data}"
RETAIN_DAYS="${RETAIN_DAYS:-7}"
DATE=$(date +%Y%m%d-%H%M%S)
LOG="${LOG:-/var/log/clawnet-backup.log}"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$LOG"; }

log "=== Backup started: $DATE ==="

# ── SQLite hot backup ─────────────────────────────────────────────────────────
SQLITE_DEST="$BACKUP_DIR/sqlite-$DATE"
mkdir -p "$SQLITE_DEST"
for db in "$DATA_DIR"/*.sqlite; do
  [ -f "$db" ] || continue
  name=$(basename "$db")
  sqlite3 "$db" ".backup $SQLITE_DEST/$name"
  log "  sqlite backed up: $name"
done
tar -czf "$BACKUP_DIR/sqlite-$DATE.tar.gz" -C "$BACKUP_DIR" "sqlite-$DATE"
rm -rf "$SQLITE_DEST"
log "  sqlite archive: sqlite-$DATE.tar.gz"

# ── Chain data backup ─────────────────────────────────────────────────────────
if [ -d "$CHAIN_DIR" ]; then
  tar -czf "$BACKUP_DIR/chain-$DATE.tar.gz" -C "$(dirname "$CHAIN_DIR")" "$(basename "$CHAIN_DIR")"
  log "  chain archive: chain-$DATE.tar.gz"
else
  log "  WARNING: chain-data dir not found, skipping"
fi

# ── Retention: delete backups older than RETAIN_DAYS ─────────────────────────
find "$BACKUP_DIR" -maxdepth 1 -name "*.tar.gz" -mtime +$RETAIN_DAYS -delete
log "  pruned backups older than $RETAIN_DAYS days"

# ── Summary ──────────────────────────────────────────────────────────────────
TOTAL=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name "*.tar.gz" | wc -l)
log "=== Backup complete: $COUNT archives, total $TOTAL ==="
