# Skill: Upgrade clawnetd.com to Latest

## Overview

This skill describes the full procedure to upgrade the production ClawNet node running at **clawnetd.com** (IP `38.47.238.72`) to the latest code from the `main` branch.

---

## Server Details

| Item | Value |
|------|-------|
| **IP** | `38.47.238.72` |
| **OS** | Ubuntu 24.04 |
| **Domain** | `clawnetd.com` / `api.clawnetd.com` |
| **SSH** | `ssh root@38.47.238.72` (key-based auth) |
| **Code path** | `/opt/clawnet` |
| **Data path** | `/var/lib/clawnet` |
| **Service** | `clawnet.service` (systemd) |
| **API port** | `9528` (internal, behind Caddy) |
| **P2P port** | `9527` (public TCP) |
| **Reverse proxy** | Caddy → `localhost:9528` |
| **Node.js** | v20 (system-installed) |
| **Package manager** | pnpm v10 |

### Systemd Service File

Located at `/etc/systemd/system/clawnet.service`:

```ini
[Unit]
Description=ClawNet Node
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/clawnet/packages/node
ExecStart=/usr/bin/node dist/daemon.js --data-dir /var/lib/clawnet --api-host 127.0.0.1 --api-port 9528 --listen /ip4/0.0.0.0/tcp/9527
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=CLAW_DATA_DIR=/var/lib/clawnet
Environment=CLAW_API_KEY=<redacted>
Environment=CLAW_PASSPHRASE=<redacted>
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

### Caddy Reverse Proxy

Located at `/etc/caddy/Caddyfile`:

- `api.clawnetd.com` → reverse proxy to `localhost:9528`
  - `/api/node/status` (GET) is public (no auth)
  - All other routes require `X-API-Key` header
- `clawnetd.com` → serves homepage from `packages/homepage/dist` (see `skills/deploy-homepage.md`)

---

## Prerequisites

1. All changes are committed and pushed to `origin/main`
2. SSH key access to `root@38.47.238.72` is configured
3. The build passes locally (`pnpm build` succeeds)

---

## Upgrade Steps

### Step 1: Ensure local code is pushed

**Windows (PowerShell):**
```powershell
cd c:\Users\11701\Workspace\clawnet
git status                    # verify clean working tree
git push origin main          # push latest to GitHub
git log --oneline -1          # note the commit hash
```

**macOS / Ubuntu (Bash):**
```bash
cd ~/Workspace/clawnet
git status                    # verify clean working tree
git push origin main          # push latest to GitHub
git log --oneline -1          # note the commit hash
```

### Step 2: Check current server state

**All platforms (same SSH command):**
```bash
ssh root@38.47.238.72 "cd /opt/clawnet && git log --oneline -1 && systemctl is-active clawnet"
```

This shows the commit currently deployed and whether the service is running.

### Step 3: Pull latest code on the server

```bash
ssh root@38.47.238.72 "cd /opt/clawnet && git pull origin main 2>&1"
```

> **Note**: The remote on the server is set to HTTPS (`https://github.com/claw-network/clawnet.git`). If it was previously SSH and fails with "Permission denied (publickey)", fix it with:
> ```bash
> ssh root@38.47.238.72 "cd /opt/clawnet && git remote set-url origin https://github.com/claw-network/clawnet.git"
> ```

### Step 4: Install dependencies (if needed)

```bash
ssh root@38.47.238.72 "cd /opt/clawnet && pnpm install 2>&1 | tail -5"
```

This is only needed if `package.json` or `pnpm-lock.yaml` changed. It's safe to always run — it will report "Already up to date" if nothing changed.

### Step 5: Rebuild

```bash
ssh root@38.47.238.72 "cd /opt/clawnet && pnpm build 2>&1 | tail -10"
```

Verify the output shows all packages built successfully:
```
packages/core build: Done
packages/protocol build: Done
packages/sdk build: Done
packages/node build: Done
packages/cli build: Done
```

If you encounter stale `tsbuildinfo` errors like `TS6305: Output file ... has not been built from source file`, clean and rebuild:

```bash
ssh root@38.47.238.72 "cd /opt/clawnet && find packages -name dist -type d -exec rm -rf {} + 2>/dev/null; find packages -name tsconfig.tsbuildinfo -delete 2>/dev/null; pnpm build 2>&1 | tail -10"
```

### Step 6: Restart the service

```bash
ssh root@38.47.238.72 "systemctl restart clawnet"
```

### Step 7: Verify the upgrade

Wait a few seconds for startup, then verify:

```bash
ssh root@38.47.238.72 "sleep 3 && curl -s http://127.0.0.1:9528/api/node/status | python3 -m json.tool"
```

Expected output (example):
```json
{
    "did": "did:claw:zGdsjCwGWZagTeXN4xyV13L8eDzUVGbVZhqJhChRXFuea",
    "peerId": "12D3KooWRTEtx4rDkUwx4QsVbaELp8DUiKX8JHa3fRfiagaR9rNW",
    "synced": true,
    "blockHeight": 0,
    "peers": 0,
    "connections": 0,
    "network": "devnet",
    "version": "0.2.0",
    "uptime": 3
}
```

Check that:
- `version` matches the version in `packages/node/package.json`
- `synced` is `true`
- `uptime` is a small number (freshly restarted)

Also verify via the public HTTPS endpoint:

**Windows (PowerShell):**
```powershell
Invoke-RestMethod -Uri "https://api.clawnetd.com/api/node/status"
```

**macOS / Ubuntu (Bash):**
```bash
curl -s https://api.clawnetd.com/api/node/status | python3 -m json.tool
```

### Step 8: Check service logs (optional)

```bash
ssh root@38.47.238.72 "journalctl -u clawnet --no-pager -n 20"
```

Look for the startup banner:
```
[INFO] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[INFO] clawnetd
[INFO] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[INFO] Data Dir : /var/lib/clawnet
[INFO] Peer Id  : 12D3KooWRTEtx4rDkUwx4QsVbaELp8DUiKX8JHa3fRfiagaR9rNW
[INFO] DID      : did:claw:zGdsjCwGWZagTeXN4xyV13L8eDzUVGbVZhqJhChRXFuea
[INFO] Network  : devnet
[INFO] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## One-Liner (Quick Upgrade)

For a fast upgrade when you know the code is already pushed:

**All platforms (same SSH command):**
```bash
ssh root@38.47.238.72 "cd /opt/clawnet && git pull origin main 2>&1 && pnpm install 2>&1 | tail -3 && pnpm build 2>&1 | tail -10 && systemctl restart clawnet && sleep 3 && curl -s http://127.0.0.1:9528/api/node/status | python3 -m json.tool"
```

---

## Troubleshooting

### Service won't start

```bash
# Check logs
journalctl -u clawnet --no-pager -n 50

# Check if port is in use
ss -tlnp | grep -E '9527|9528'

# Manual test run
cd /opt/clawnet/packages/node
CLAW_PASSPHRASE=<passphrase> node dist/daemon.js --data-dir /var/lib/clawnet --api-host 127.0.0.1 --api-port 9528
```

### Git pull fails with permission denied

```bash
cd /opt/clawnet
git remote set-url origin https://github.com/claw-network/clawnet.git
git pull origin main
```

### Build fails with stale cache

```bash
cd /opt/clawnet
find packages -name dist -type d -exec rm -rf {} + 2>/dev/null
find packages -name tsconfig.tsbuildinfo -delete 2>/dev/null
pnpm build
```

### API returns old version

The version is read from `packages/node/package.json`. If it wasn't bumped, the API will show the old version even though the code is updated. The version can also be overridden via `CLAWNET_VERSION` environment variable in the service file.

### Caddy not proxying

```bash
systemctl status caddy
journalctl -u caddy --no-pager -n 20
caddy validate --config /etc/caddy/Caddyfile
```

---

## Rollback

If the upgrade causes issues, roll back to a specific commit:

```bash
cd /opt/clawnet
git log --oneline -10          # find the previous good commit
git checkout <commit-hash>     # check out that commit
pnpm build                     # rebuild
systemctl restart clawnet      # restart
```

To return to tracking `main` afterwards:

```bash
git checkout main
```
