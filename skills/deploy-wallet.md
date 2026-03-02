# Skill: Deploy ClawNet Wallet Web App

## Overview

This skill describes the full procedure to build and deploy the ClawNet Wallet webapp (`packages/wallet`) to production at **https://wallet.clawnetd.com**. The wallet is a static SPA served by Caddy on the same server that runs the ClawNet node and homepage.

---

## Server Details

| Item | Value |
|------|-------|
| **IP** | `66.94.125.242` |
| **OS** | Ubuntu 24.04 |
| **Domain** | `wallet.clawnetd.com` |
| **SSH** | `ssh root@66.94.125.242` (key-based auth) |
| **Code path** | `/opt/clawnet` |
| **Wallet source** | `/opt/clawnet/packages/wallet` |
| **Wallet dist** | `/opt/clawnet/packages/wallet/dist` |
| **Reverse proxy** | Caddy (systemd: `caddy.service`) |
| **Caddyfile** | `/etc/caddy/Caddyfile` |
| **Build tool** | Vite 6 |
| **Node.js** | v20 (system-installed) |
| **Package manager** | pnpm v10 |

---

## Caddy Configuration

Add the following block to `/etc/caddy/Caddyfile`:

```caddyfile
wallet.clawnetd.com {
	root * /opt/clawnet/packages/wallet/dist
	try_files {path} /index.html
	file_server

	header {
		X-Content-Type-Options nosniff
		Strict-Transport-Security "max-age=31536000"
		-Server
	}
}
```

Key points:
- `try_files {path} /index.html` enables SPA client-side routing
- Caddy auto-manages TLS certificates via Let's Encrypt
- The wallet.clawnetd.com subdomain DNS must already point to 66.94.125.242

---

## Prerequisites

1. All wallet changes are committed and pushed to `origin/main`
2. SSH key access to `root@66.94.125.242` is configured
3. The wallet builds locally (`cd packages/wallet && pnpm exec vite build`)
4. DNS A record for `wallet.clawnetd.com` → `66.94.125.242` is active

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

### Step 3: Install dependencies and build

```bash
ssh root@66.94.125.242 "cd /opt/clawnet && pnpm install --filter @claw-network/wallet && cd packages/wallet && pnpm exec vite build"
```

### Step 4: Add Caddy config (first-time only)

If the `wallet.clawnetd.com` block does not exist in Caddyfile:

```bash
ssh root@66.94.125.242 'cat >> /etc/caddy/Caddyfile << '"'"'EOF'"'"'

wallet.clawnetd.com {
	root * /opt/clawnet/packages/wallet/dist
	try_files {path} /index.html
	file_server

	header {
		X-Content-Type-Options nosniff
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
curl -sI https://wallet.clawnetd.com | head -5
```

Expected: `HTTP/2 200` with valid TLS.

---

## Subsequent Deploys

After initial setup, only steps 1–3 and 5 are needed:

```bash
# Local
git push origin main

# Server
ssh root@66.94.125.242 "cd /opt/clawnet && git pull origin main && pnpm install --filter @claw-network/wallet && cd packages/wallet && pnpm exec vite build && systemctl reload caddy"
```

---

## Wallet App Structure

```
packages/wallet/
├── index.html            # SPA entry point
├── package.json          # @claw-network/wallet
├── vite.config.ts        # Vite build config (port 3001 dev)
├── public/
│   ├── favicon.svg       # ClawNet logo
│   └── robots.txt
└── src/
    ├── main.ts           # App bootstrap + router
    ├── styles/main.css   # Full CSS (~600 lines, dark theme)
    ├── api/client.ts     # Lightweight fetch-based API client
    ├── state/store.ts    # Reactive state management
    ├── components/
    │   ├── brand.ts      # Logo SVG
    │   ├── modal.ts      # Modal dialog
    │   ├── nav.ts        # Navigation bar
    │   └── toast.ts      # Toast notifications
    ├── pages/
    │   ├── connect.ts    # Node connection form
    │   ├── dashboard.ts  # Balance overview + recent TXs
    │   ├── transfer.ts   # Send Tokens form
    │   ├── history.ts    # Transaction history + pagination
    │   └── escrow.ts     # Escrow management
    └── utils/
        └── format.ts     # Number/time/address formatters
```

## Tech Stack

- **Vite + TypeScript**: Build tool and dev server
- **Pure HTML/CSS/TS**: No framework — vanilla SPA
- **CSS Variables**: Dark theme consistent with clawnetd.com
- **Fonts**: Space Grotesk + IBM Plex Mono (Google Fonts CDN)
- **API Client**: Raw fetch with 15s timeout, no SDK dependency
- **State**: Simple pub/sub store with localStorage persistence for connection

## Features

| Feature | Page | API Endpoints |
|---------|------|---------------|
| Connect to node | `/connect` | `GET /api/v1/node/status` |
| View balance | `/dashboard` | `GET /api/v1/wallets/:did` |
| Send tokens | `/transfer` | `POST /api/v1/transfers` |
| Transaction history | `/history` | `GET /api/v1/wallets/:did/transactions` |
| Escrow management | `/escrow` | `POST /api/v1/escrows`, `GET /api/v1/escrows/:id` |
| Identity display | `/dashboard` | `GET /api/v1/identities/self` |
