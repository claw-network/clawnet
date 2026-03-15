# Skill: Deploy ClawNet Console Web App

## Overview

This skill describes the full procedure to build and deploy the ClawNet Console webapp (`packages/console`) to production at **https://console.clawnetd.com**. The console is a static SPA served by Caddy, with API requests reverse-proxied to the ClawNet node backend.

Unlike the wallet (pure static), the console needs a reverse proxy for `/api/*` requests to reach the node's REST API on port 9528.

---

## Server Details

| Item | Value |
|------|-------|
| **IP** | `66.94.125.242` |
| **OS** | Ubuntu 24.04 |
| **Domain** | `console.clawnetd.com` |
| **SSH** | `ssh root@66.94.125.242` (key-based auth) |
| **Code path** | `/opt/clawnet` |
| **Console source** | `/opt/clawnet/packages/console` |
| **Console dist** | `/opt/clawnet/packages/console/dist` |
| **Reverse proxy** | Caddy (systemd: `caddy.service`) |
| **Caddyfile** | `/etc/caddy/Caddyfile` |
| **Node API** | `127.0.0.1:9528` |
| **Build tool** | Vite 6 |
| **Node.js** | v20 (system-installed) |
| **Package manager** | pnpm v10 |

---

## Build Modes

The console supports two serving modes via the `VITE_BASE_PATH` env var:

| Mode | Base Path | Usage |
|------|-----------|-------|
| **Embedded** (default) | `/console/` | Served by the node daemon at `localhost:9528/console/` |
| **Standalone** | `/` | Served by Caddy at `console.clawnetd.com` |

For standalone deployment, build with:
```bash
VITE_BASE_PATH=/ pnpm exec vite build
```

---

## Caddy Configuration

Add the following block to `/etc/caddy/Caddyfile`:

```caddyfile
console.clawnetd.com {
	handle /api/* {
		reverse_proxy 127.0.0.1:9528
	}

	handle {
		root * /opt/clawnet/packages/console/dist
		try_files {path} /index.html
		file_server
	}

	header {
		X-Content-Type-Options nosniff
		X-Frame-Options DENY
		Strict-Transport-Security "max-age=31536000"
		-Server
	}
}
```

Key points:
- `/api/*` requests are reverse-proxied to the node backend (port 9528)
- All other requests serve the SPA static files
- `try_files {path} /index.html` enables SPA client-side routing
- `X-Frame-Options DENY` prevents clickjacking on the admin console
- Caddy auto-manages TLS certificates via Let's Encrypt
- The `console.clawnetd.com` subdomain DNS must already point to `66.94.125.242`

---

## Prerequisites

1. All console changes are committed and pushed to `origin/main`
2. SSH key access to `root@66.94.125.242` is configured
3. The console builds locally (`cd packages/console && VITE_BASE_PATH=/ pnpm exec vite build`)
4. DNS A record for `console.clawnetd.com` → `66.94.125.242` is active

---

## Deploy Steps

### Step 1: Ensure local code is pushed

```bash
cd ~/Workspace/OpenClaw/clawnet
git status
git push origin main
git log --oneline -1
```

### Step 2: Pull latest code on server

```bash
ssh root@66.94.125.242 "cd /opt/clawnet && git pull origin main"
```

### Step 3: Install dependencies and build (standalone mode)

```bash
ssh root@66.94.125.242 "cd /opt/clawnet && pnpm install --filter @claw-network/console && cd packages/console && VITE_BASE_PATH=/ pnpm exec vite build"
```

### Step 4: Add Caddy config (first-time only)

If the `console.clawnetd.com` block does not exist in Caddyfile:

```bash
ssh root@66.94.125.242 'cat >> /etc/caddy/Caddyfile << '"'"'EOF'"'"'

console.clawnetd.com {
	handle /api/* {
		reverse_proxy 127.0.0.1:9528
	}

	handle {
		root * /opt/clawnet/packages/console/dist
		try_files {path} /index.html
		file_server
	}

	header {
		X-Content-Type-Options nosniff
		X-Frame-Options DENY
		Strict-Transport-Security "max-age=31536000"
		-Server
	}
}
EOF'
```

### Step 5: Reload Caddy

```bash
ssh root@66.94.125.242 "caddy fmt --overwrite /etc/caddy/Caddyfile && systemctl reload caddy"
```

### Step 6: Verify

```bash
curl -sI https://console.clawnetd.com | head -5
```

Expected: `HTTP/2 200` with valid TLS.

---

## Quick Re-deploy (after code changes)

```bash
git push origin main
ssh root@66.94.125.242 "cd /opt/clawnet && git pull origin main && cd packages/console && VITE_BASE_PATH=/ pnpm exec vite build"
```

No Caddy reload needed for content-only changes.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| 404 on page refresh | Ensure `try_files {path} /index.html` is in Caddy config |
| API returns 502 | Check `systemctl status clawnetd` — node may be down |
| Blank page | Verify `VITE_BASE_PATH=/` was set during build; check browser console for asset 404s |
| TLS error | Ensure DNS A record for `console.clawnetd.com` → `66.94.125.242` and Caddy can reach Let's Encrypt |
| Login fails | Verify the node passphrase is set (`CLAW_PASSPHRASE` env var on node) |
