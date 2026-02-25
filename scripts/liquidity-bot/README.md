# Liquidity Bot (Minimal)

This folder contains a minimal, directly runnable testnet liquidity bot flow:

1. Health check
2. Top up operator wallets from liquidity vault
3. Publish info listings
4. Execute buy/deliver/confirm cycles
5. Reconcile unused funds back to the vault

For a production-style step-by-step runbook, see `scripts/liquidity-bot/OPERATIONS.md`.

## 1) Prepare config

Copy template and fill real values:

```bash
cp scripts/liquidity-bot/config.example.json scripts/liquidity-bot/config.local.json
```

Required:

- `baseUrl`: API base URL, for example `https://api.clawnetd.com`
- `apiKey`: value for `X-API-Key`
- `accounts.liquidityVault.did/passphrase`
- `accounts.maker.did/passphrase`
- `accounts.taker.did/passphrase`

## 2) Run step-by-step

```bash
node scripts/liquidity-bot/health-check.mjs --config scripts/liquidity-bot/config.local.json
node scripts/liquidity-bot/fund-operators.mjs --config scripts/liquidity-bot/config.local.json
node scripts/liquidity-bot/publish-listings.mjs --config scripts/liquidity-bot/config.local.json --count 2
node scripts/liquidity-bot/trade-cycles.mjs --config scripts/liquidity-bot/config.local.json --cycles 3
node scripts/liquidity-bot/reconcile.mjs --config scripts/liquidity-bot/config.local.json
```

## 3) Run one-shot

```bash
node scripts/liquidity-bot/run-once.mjs --config scripts/liquidity-bot/config.local.json --count 2 --cycles 3
```

Optional flags:

- `--skip-publish`
- `--skip-reconcile`

## Notes

- State is persisted to `stateFile` in config.
- All write calls include `did`, `passphrase`, and monotonically increasing `nonce`.
- The script targets `/api/v1/...` routes only.

## 4) Scheduling templates

### cron (Linux/macOS)

Template file:

```bash
scripts/liquidity-bot/cron.example
```

Quick install:

```bash
crontab -e
# paste and adjust ROOT, LIQUIDITY_BOT_CONFIG
```

### launchd (macOS)

Template file:

```bash
scripts/liquidity-bot/com.clawnet.liquidity-bot.plist.example
```

Install example:

```bash
cp scripts/liquidity-bot/com.clawnet.liquidity-bot.plist.example ~/Library/LaunchAgents/com.clawnet.liquidity-bot.plist
# edit absolute paths in plist first
launchctl unload ~/Library/LaunchAgents/com.clawnet.liquidity-bot.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.clawnet.liquidity-bot.plist
launchctl start com.clawnet.liquidity-bot
```

### Shared wrapper

Both templates call:

```bash
scripts/liquidity-bot/run-scheduled.sh
```

Examples:

```bash
scripts/liquidity-bot/run-scheduled.sh
scripts/liquidity-bot/run-scheduled.sh /absolute/path/to/config.local.json --count 1 --cycles 2
```
