# Skill: Deploy ClawNet Homepage

## Overview

This skill describes the full procedure to build and deploy the ClawNet homepage (`packages/homepage`) to production at **https://clawnetd.com**. The homepage is a static SPA served by Caddy on the same server that runs the ClawNet node.

---

## Server Details

| Item | Value |
|------|-------|
| **IP** | `38.47.238.72` |
| **OS** | Ubuntu 24.04 |
| **Domain** | `clawnetd.com` |
| **SSH** | `ssh root@38.47.238.72` (key-based auth) |
| **Code path** | `/opt/clawnet` |
| **Homepage source** | `/opt/clawnet/packages/homepage` |
| **Homepage dist** | `/opt/clawnet/packages/homepage/dist` |
| **Reverse proxy** | Caddy (systemd: `caddy.service`) |
| **Caddyfile** | `/etc/caddy/Caddyfile` |
| **Build tool** | Vite 6.4.1 |
| **Node.js** | v20 (system-installed) |
| **Package manager** | pnpm v10 |

### Caddy Configuration

Located at `/etc/caddy/Caddyfile`, the `clawnetd.com` block:

```caddyfile
clawnetd.com {
	handle /install.sh {
		header Content-Type "text/x-shellscript; charset=utf-8"
		header Content-Disposition inline
		file_server {
			root /var/www/clawnetd
		}
	}

	handle {
		root * /opt/clawnet/packages/homepage/dist
		try_files {path} /index.html
		file_server
	}

	header {
		X-Content-Type-Options nosniff
		Strict-Transport-Security "max-age=31536000"
		-Server
	}
}
```

Key points:
- `/install.sh` is served from `/var/www/clawnetd/install.sh` (separate from the homepage)
- All other paths are served from the Vite build output at `packages/homepage/dist`
- `try_files {path} /index.html` enables SPA client-side routing
- Caddy auto-manages TLS certificates via Let's Encrypt
- The `api.clawnetd.com` block is separate and unchanged by homepage deployments

### Homepage Tech Stack

- **Vite + TypeScript**: Build tool and dev server
- **Pure HTML/CSS**: No framework, single `index.html` (~780 lines)
- **Styles**: `src/styles/main.css` (~890 lines), dark theme (#0a0a0a base), CSS custom properties
- **Interactions**: `src/main.ts` (~136 lines) — mobile nav, tab switching, scroll animations
- **Fonts**: Inter + JetBrains Mono (Google Fonts CDN)
- **Public files**: `robots.txt`, `sitemap.xml`, `.well-known/ai-plugin.json`, `.well-known/agent-protocol.json`

---

## Prerequisites

1. All homepage changes are committed and pushed to `origin/main`
2. SSH key access to `root@38.47.238.72` is configured
3. The homepage builds locally (`cd packages/homepage && pnpm exec vite build`)

---

## Deploy Steps

### Step 1: Ensure local code is pushed

**Windows (PowerShell):**
```powershell
cd c:\Users\11701\Workspace\claw-token
git status                    # verify clean working tree
git push origin main          # push latest to GitHub
git log --oneline -1          # note the commit hash
```

**macOS / Ubuntu (Bash):**
```bash
cd ~/Workspace/claw-token
git status
git push origin main
git log --oneline -1
```

### Step 2: Check current server state

```bash
ssh root@38.47.238.72 "cd /opt/clawnet && git log --oneline -1 && systemctl is-active caddy"
```

Verify that Caddy is `active` and note the current commit.

### Step 3: Pull latest code on the server

```bash
ssh root@38.47.238.72 "cd /opt/clawnet && git pull origin main 2>&1"
```

Verify the output shows `packages/homepage/` files changed.

> **Note**: The remote on the server uses HTTPS (`https://github.com/claw-network/clawnet.git`). If it fails with "Permission denied (publickey)", fix:
> ```bash
> ssh root@38.47.238.72 "cd /opt/clawnet && git remote set-url origin https://github.com/claw-network/clawnet.git"
> ```

### Step 4: Install dependencies (if needed)

```bash
ssh root@38.47.238.72 "cd /opt/clawnet && pnpm install 2>&1 | tail -5"
```

Only needed if `package.json` or `pnpm-lock.yaml` changed. Safe to always run.

### Step 5: Build the homepage

```bash
ssh root@38.47.238.72 "cd /opt/clawnet/packages/homepage && pnpm exec vite build 2>&1"
```

Expected output:
```
vite v6.4.1 building for production...
✓ 3 modules transformed.
dist/index.html                  42.31 kB │ gzip: 10.37 kB
dist/assets/main-XXXXXXXX.css    17.18 kB │ gzip:  4.74 kB
dist/assets/main-XXXXXXXX.js      3.07 kB │ gzip:  1.55 kB
✓ built in XXXms
```

Verify the dist directory:
```bash
ssh root@38.47.238.72 "ls -la /opt/clawnet/packages/homepage/dist/"
```

Expected files:
- `index.html` — main page
- `assets/` — CSS and JS bundles (content-hashed filenames)
- `.well-known/` — AI agent discovery files
- `favicon.svg` — site icon
- `og-image.svg` — Open Graph image
- `robots.txt` — search engine directives
- `sitemap.xml` — sitemap
- `404.html` — error page

### Step 6: Verify the deployment

No Caddy reload is needed — Caddy serves files directly from the `dist/` directory, so the new build is live immediately after Step 5.

**From the server:**
```bash
ssh root@38.47.238.72 "curl -s https://clawnetd.com | head -5"
```

Expected:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

**From Windows (PowerShell):**
```powershell
(Invoke-WebRequest -Uri "https://clawnetd.com" -UseBasicParsing).StatusCode
# Should return: 200
```

**Also verify sub-paths:**
```bash
ssh root@38.47.238.72 "curl -sI https://clawnetd.com/install.sh 2>&1 | head -3"
# Should return: HTTP/2 200 with content-type: text/x-shellscript

ssh root@38.47.238.72 "curl -sI https://clawnetd.com/.well-known/ai-plugin.json 2>&1 | head -3"
# Should return: HTTP/2 200 with content-type: application/json
```

---

## One-Liner (Quick Deploy)

For a fast homepage deploy when you know the code is already pushed:

```bash
ssh root@38.47.238.72 "cd /opt/clawnet && git pull origin main 2>&1 && pnpm install 2>&1 | tail -3 && cd packages/homepage && pnpm exec vite build 2>&1 && echo '--- Deployed! ---' && curl -s https://clawnetd.com | head -3"
```

---

## Updating the Caddy Configuration

If you need to change the Caddy configuration (e.g., add headers, new routes):

### Step 1: Back up the current config

```bash
ssh root@38.47.238.72 "cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak"
```

### Step 2: Write the new Caddyfile

Create the Caddyfile locally and SCP it to the server. **Do not try to write multi-line files via SSH heredoc from Windows PowerShell** — quoting issues will cause failures.

```powershell
# From Windows PowerShell:
scp path\to\Caddyfile root@38.47.238.72:/etc/caddy/Caddyfile
```

```bash
# From macOS / Ubuntu:
scp path/to/Caddyfile root@38.47.238.72:/etc/caddy/Caddyfile
```

### Step 3: Validate and reload

```bash
ssh root@38.47.238.72 "caddy validate --config /etc/caddy/Caddyfile 2>&1 | tail -3"
# Must show: Valid configuration

ssh root@38.47.238.72 "caddy fmt --overwrite /etc/caddy/Caddyfile; systemctl reload caddy"

ssh root@38.47.238.72 "systemctl status caddy 2>&1 | head -10"
# ExecReload should show status=0/SUCCESS
```

### Step 4: Rollback if Caddy fails

```bash
ssh root@38.47.238.72 "cp /etc/caddy/Caddyfile.bak /etc/caddy/Caddyfile && systemctl reload caddy"
```

---

## Troubleshooting

### Browser still redirects to GitHub

The old Caddy config had a 301 redirect to GitHub. Browsers aggressively cache 301 (permanent) redirects. Fix:

1. Open DevTools (F12)
2. Right-click refresh button → **"Empty Cache and Hard Reload"**
3. Or `Ctrl+Shift+Delete` → clear cached images and files → reload

The server itself returns 200 — verify with:
```powershell
Invoke-WebRequest -Uri "https://clawnetd.com" -MaximumRedirection 0 -UseBasicParsing | Select-Object StatusCode
```

### Vite build fails

```bash
# Check Node.js and pnpm versions
ssh root@38.47.238.72 "node -v && pnpm -v"

# Clean and rebuild
ssh root@38.47.238.72 "cd /opt/clawnet/packages/homepage && rm -rf dist node_modules/.vite && pnpm exec vite build 2>&1"
```

### CSS/JS not updating (stale assets)

Vite uses content-hashed filenames (`main-XXXXXXXX.css`), so browsers always fetch the latest bundle when `index.html` changes. If assets appear stale:

```bash
# Verify the dist has new hashes
ssh root@38.47.238.72 "ls /opt/clawnet/packages/homepage/dist/assets/"

# Force clear browser cache (or hard reload)
```

### install.sh returns 404

The install script is served from `/var/www/clawnetd/install.sh`, not from the homepage dist. Verify:

```bash
ssh root@38.47.238.72 "ls -la /var/www/clawnetd/install.sh"
```

If missing, copy it:
```bash
ssh root@38.47.238.72 "mkdir -p /var/www/clawnetd && cp /opt/clawnet/install.sh /var/www/clawnetd/install.sh"
```

### Caddy won't start or reload

```bash
ssh root@38.47.238.72 "systemctl status caddy"
ssh root@38.47.238.72 "journalctl -u caddy --no-pager -n 20"
ssh root@38.47.238.72 "caddy validate --config /etc/caddy/Caddyfile 2>&1"
```

### SPA routes return 404

The `try_files {path} /index.html` directive handles client-side routing. If it's missing from the Caddyfile, deep links will 404. Verify:

```bash
ssh root@38.47.238.72 "curl -sI https://clawnetd.com/some-nonexistent-path 2>&1 | head -3"
# Should return HTTP/2 200 (serves index.html as fallback)
```

---

## Local Development

Run the homepage dev server locally:

```powershell
cd c:\Users\11701\Workspace\claw-token\packages\homepage
pnpm dev
# Opens at http://localhost:3000
```

Build and preview locally:

```powershell
pnpm exec vite build
pnpm exec vite preview
# Opens at http://localhost:4173
```

---

## File Structure

```
packages/homepage/
├── index.html              # Main page (~780 lines)
├── vite.config.ts          # Vite config (port 3000, public dir)
├── package.json            # Dependencies (vite, typescript)
├── tsconfig.json           # TypeScript config
├── public/
│   ├── .well-known/
│   │   ├── ai-plugin.json      # AI agent discovery
│   │   └── agent-protocol.json # Agent protocol metadata
│   ├── favicon.svg
│   ├── og-image.svg
│   ├── robots.txt
│   ├── sitemap.xml
│   └── 404.html
└── src/
    ├── main.ts             # Page interactions (~136 lines)
    └── styles/
        └── main.css        # Full design system (~890 lines)
```
