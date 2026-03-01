# Skill: Deploy ClawNet Documentation Site

## Overview

This skill describes the full procedure to edit, build, commit, push, and deploy the ClawNet documentation site (`packages/docs`) to production at **https://docs.clawnetd.com**. The docs site is a Next.js (Fumadocs) application served by a systemd service behind Caddy on the same server that runs the ClawNet node and homepage.

---

## Server Details

| Item | Value |
|------|-------|
| **IP** | `66.94.125.242` |
| **OS** | Ubuntu 24.04 |
| **Domain** | `docs.clawnetd.com` |
| **SSH alias** | `clawnet-geth-a` (configured in `~/.ssh/config`) |
| **SSH key** | `~/.ssh/id_ed25519_clawnet` |
| **Code path** | `/opt/clawnet` |
| **Docs source** | `/opt/clawnet/packages/docs` |
| **Systemd service** | `clawnet-docs.service` |
| **Internal port** | `3001` |
| **Reverse proxy** | Caddy → `localhost:3001` |
| **Framework** | Next.js 15.5 + Fumadocs (fumadocs-ui/fumadocs-mdx/fumadocs-core) |
| **CSS** | Tailwind CSS v4 |
| **Node.js** | v20 (system-installed) |
| **Package manager** | pnpm v10 (monorepo workspace) |
| **Git branch** | `main` |
| **Git remote (server)** | HTTPS (`https://github.com/claw-network/clawnet.git`) |

### Caddy Configuration (excerpt)

Located at `/etc/caddy/Caddyfile`:

```caddyfile
docs.clawnetd.com {
	reverse_proxy localhost:3001

	header {
		X-Content-Type-Options nosniff
		Strict-Transport-Security "max-age=31536000"
		-Server
	}
}
```

Caddy auto-manages TLS certificates via Let's Encrypt.

### Systemd Service

Located at `/etc/systemd/system/clawnet-docs.service`:

```ini
[Unit]
Description=ClawNet Docs
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/clawnet/packages/docs
ExecStart=/usr/bin/npx next start -p 3001
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### Docs Tech Stack

- **Next.js 15 + Fumadocs**: SSG documentation framework with App Router
- **Content**: Markdown/MDX files in `content/docs/` (i18n: EN default + ZH via `.zh.md` suffix)
- **i18n**: `en` (default, hidden locale) and `zh`; nav metadata in `meta.json` / `meta.zh.json`
- **Source config**: `source.config.ts` defines content directory; `lib/source.ts` sets `baseUrl: '/'`
- **URL structure**: Docs served at root `/` (not `/docs`); old `/docs/*` paths 308-redirect to `/*`
- **Build output**: `.next/` (SSG static pages + server middleware)
- **Custom plugins**: `lib/remark-mermaid.mjs` (Mermaid diagram rendering)

---

## Content Structure

```
packages/docs/
├── content/docs/
│   ├── index.md / index.zh.md           # Landing page
│   ├── meta.json / meta.zh.json         # Top-level nav order
│   ├── getting-started/                  # Quickstart + core concepts
│   │   ├── meta.json / meta.zh.json
│   │   └── core-concepts/
│   │       ├── meta.json / meta.zh.json
│   │       ├── identity.md / .zh.md
│   │       ├── wallet.md / .zh.md
│   │       ├── markets.md / .zh.md
│   │       ├── service-contracts.md / .zh.md
│   │       ├── smart-contracts.md / .zh.md
│   │       ├── reputation.md / .zh.md
│   │       └── dao.md / .zh.md
│   ├── developer-guide/                  # API reference, SDK, etc.
│   ├── business-economics/               # Economics, DAO proposals
│   ├── implementation-specs/             # Protocol spec, security, etc.
│   ├── implementation-tasks/             # Rollout tasks
│   └── event-schemas/                    # Event schema docs
├── app/
│   ├── [lang]/
│   │   ├── layout.tsx                    # RootProvider + DocsLayout
│   │   └── [[...slug]]/
│   │       └── page.tsx                  # Doc page (SSG catch-all)
│   └── page.tsx                          # Root redirect → /en
├── lib/
│   ├── source.ts                         # Fumadocs loader (baseUrl: '/')
│   ├── i18n.ts                           # Language config
│   └── remark-mermaid.mjs               # Mermaid plugin
├── components/                           # Custom MDX components
├── source.config.ts                      # Fumadocs MDX config
├── next.config.mjs                       # Next.js config + redirects
├── middleware.ts                          # i18n middleware
└── package.json                          # @claw-network/docs
```

---

## Prerequisites

1. SSH alias `clawnet-geth-a` is configured in `~/.ssh/config` pointing to `root@66.94.125.242` with key `~/.ssh/id_ed25519_clawnet`
2. Local repo is on the `main` branch with a clean working tree
3. pnpm v10 and Node.js v20+ available locally

---

## Standard Workflow

The canonical workflow is: **Edit → Build → Commit → Push → Deploy → Verify**.

### Step 1: Make changes

Edit content or code in `packages/docs/`. Common change types:

| Change Type | Files Involved |
|-------------|---------------|
| New page | Create `content/docs/<section>/<slug>.md` + `.zh.md`; add slug to `meta.json` and `meta.zh.json` |
| Edit content | Modify existing `.md` / `.zh.md` files |
| Remove page | Delete `.md` / `.zh.md` files; remove from `meta.json` and `meta.zh.json`; check for cross-references |
| Merge pages | Append content into target; delete source files; update `meta.json`/`meta.zh.json`; grep for stale links |
| Layout/theme | Edit `app/`, `components/`, `lib/`, CSS files |
| Navigation | Edit `meta.json` / `meta.zh.json` (controls sidebar order and titles) |
| Config | Edit `next.config.mjs`, `source.config.ts`, `middleware.ts` |

**i18n rules:**
- Every `.md` page should have a `.zh.md` counterpart
- Every `meta.json` should have a `meta.zh.json` counterpart
- EN is the default (hidden) locale; ZH uses `.zh` suffix

**Cross-reference cleanup (when removing/renaming pages):**
```bash
grep -rn '<old-slug>' packages/docs/content/
```
Update or remove any stale links found.

### Step 2: Build locally

```bash
pnpm --filter docs build
```

This runs `next build` which:
- Compiles MDX content (reports MDX errors)
- Type-checks TypeScript
- Generates static pages (SSG)
- Reports page count and bundle sizes

**Expected output (last few lines):**
```
Route (app)                                    Size  First Load JS
┌ ○ /                                         136 B         103 kB
├ ● /[lang]/[[...slug]]                     13.5 kB         134 kB
├   └ [+N more paths]
├ ƒ /api/search                               136 B         103 kB
└ ○ /icon.svg                                   0 B            0 B
```

If the build fails, fix errors before proceeding. Common issues:
- **MDX parse error**: malformed frontmatter or broken Markdown syntax
- **TypeScript error**: type mismatch in components or config
- **Missing meta entry**: page exists but slug not in `meta.json`

### Step 3: Commit

```bash
git add -A
git commit -m "docs: <concise description of change>"
```

**Commit message conventions for docs:**
- Prefix: always `docs:` (lowercase)
- Examples:
  - `docs: add wallet setup guide`
  - `docs: merge markets and markets-advanced into single page`
  - `docs: fix broken link in service-contracts`
  - `docs: update sidebar nav order`
  - `docs: override light theme primary color`

### Step 4: Push

```bash
git push --no-verify origin main
```

> **`--no-verify` is required.** The repo has pre-push hooks that run slow contract tests. These are irrelevant for docs-only changes and would waste several minutes. Always use `--no-verify` for docs deployments.

### Step 5: Deploy to production

**Standard deploy (single command):**

```bash
ssh clawnet-geth-a "cd /opt/clawnet && git pull origin main && pnpm --filter docs build && systemctl restart clawnet-docs"
```

This command:
1. Pulls latest code from GitHub
2. Builds the docs package (Next.js SSG)
3. Restarts the systemd service to pick up the new `.next/` output

**If `pnpm-lock.yaml` changed (dependency update):**

```bash
ssh clawnet-geth-a "cd /opt/clawnet && git pull origin main && pnpm install && pnpm --filter docs build && systemctl restart clawnet-docs"
```

### Step 6: Verify

**Check HTTP status of changed/new pages:**

```bash
curl -sI https://docs.clawnetd.com/<path> | head -5
```

Expected: `HTTP/2 200` with `content-type: text/html`.

**Check that removed pages return 404:**

```bash
curl -sI https://docs.clawnetd.com/<removed-path> | head -3
```

Expected: `HTTP/2 404`.

**Check CN (Chinese) locale:**

```bash
curl -sI https://docs.clawnetd.com/zh/<path> | head -3
```

**Check redirects (if applicable):**

```bash
curl -sI https://docs.clawnetd.com/docs/<path> | head -3
```

Expected: `HTTP/2 308` with `location: /<path>` (permanent redirect from old `/docs/` prefix).

---

## One-Liner (Quick Deploy)

For a fast deploy when code is already pushed:

```bash
ssh clawnet-geth-a "cd /opt/clawnet && git pull origin main && pnpm --filter docs build && systemctl restart clawnet-docs" && echo "--- Deployed ---" && curl -sI https://docs.clawnetd.com/ | head -3
```

---

## Local Preview

To preview the docs site locally before deploying:

```bash
# Dev mode (with hot reload via Turbopack)
cd packages/docs
pnpm dev            # http://localhost:3000

# Production preview (matches server behavior)
pnpm --filter docs build
cd packages/docs
npx next start -p 3001    # http://localhost:3001
```

> **Note:** Kill any existing process on port 3001 before starting:
> ```bash
> lsof -ti :3001 | xargs kill -9 2>/dev/null
> ```

---

## Adding a Redirect

When renaming or removing pages, add permanent redirects in [packages/docs/next.config.mjs](../../packages/docs/next.config.mjs):

```javascript
async redirects() {
  return [
    // existing redirects...
    {
      source: '/old-path',
      destination: '/new-path',
      permanent: true,    // 308 status code
    },
  ];
},
```

---

## Troubleshooting

### Build fails with MDX error

```bash
# Check which files changed
git diff --name-only HEAD~1

# Validate frontmatter (must be valid YAML between --- fences)
head -10 packages/docs/content/docs/path/to/file.md
```

### Service won't start

```bash
ssh clawnet-geth-a "systemctl status clawnet-docs"
ssh clawnet-geth-a "journalctl -u clawnet-docs --no-pager -n 30"

# Check if port 3001 is already in use
ssh clawnet-geth-a "ss -tlnp | grep 3001"
```

### Git pull fails

```bash
# Verify remote uses HTTPS
ssh clawnet-geth-a "cd /opt/clawnet && git remote -v"

# Fix if needed
ssh clawnet-geth-a "cd /opt/clawnet && git remote set-url origin https://github.com/claw-network/clawnet.git"
```

### Stale build cache

```bash
ssh clawnet-geth-a "cd /opt/clawnet/packages/docs && rm -rf .next && pnpm --filter docs build"
```

### Page shows but looks broken (CSS missing)

```bash
# Verify the .next directory has static assets
ssh clawnet-geth-a "ls /opt/clawnet/packages/docs/.next/static/css/"

# Full clean rebuild
ssh clawnet-geth-a "cd /opt/clawnet/packages/docs && rm -rf .next node_modules/.cache && cd ../.. && pnpm --filter docs build && systemctl restart clawnet-docs"
```

### Caddy not proxying

```bash
ssh clawnet-geth-a "systemctl status caddy"
ssh clawnet-geth-a "journalctl -u caddy --no-pager -n 20"
ssh clawnet-geth-a "caddy validate --config /etc/caddy/Caddyfile 2>&1"
```

---

## Rollback

If a deploy causes issues, roll back to the previous commit:

```bash
# Find the previous good commit
ssh clawnet-geth-a "cd /opt/clawnet && git log --oneline -5"

# Check out that commit
ssh clawnet-geth-a "cd /opt/clawnet && git checkout <commit-hash> && pnpm --filter docs build && systemctl restart clawnet-docs"
```

Return to tracking `main` afterwards:

```bash
ssh clawnet-geth-a "cd /opt/clawnet && git checkout main"
```

---

## Checklist (Copy-Paste)

Use this checklist for every docs deployment:

```
[ ] Changes made in packages/docs/
[ ] Cross-references checked (grep for renamed/removed slugs)
[ ] i18n: both .md and .zh.md updated
[ ] i18n: meta.json and meta.zh.json in sync
[ ] Local build passes: pnpm --filter docs build
[ ] Committed with "docs: ..." message
[ ] Pushed with --no-verify
[ ] Deployed: ssh clawnet-geth-a "cd /opt/clawnet && git pull origin main && pnpm --filter docs build && systemctl restart clawnet-docs"
[ ] Verified: curl -sI https://docs.clawnetd.com/<path> returns 200
[ ] Verified: removed pages return 404 (or redirect)
```
