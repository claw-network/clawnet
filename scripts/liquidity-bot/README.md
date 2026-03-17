# Liquidity Bot (Minimal)

This folder contains a minimal, directly runnable testnet liquidity bot flow:

1. Health check
2. Top up operator wallets from liquidity vault
3. Publish info listings
4. Execute buy/deliver/confirm cycles
5. Reconcile unused funds back to the vault

For a production-style step-by-step runbook, see `scripts/liquidity-bot/OPERATIONS.md`.

## Directory layout

```text
scripts/liquidity-bot/
  cli/                    # executable .mjs commands
  lib/                    # shared runtime/library code
  run/                    # scheduler wrapper scripts (.sh)
  templates/              # config/scheduler templates
    launchd/              # launchd plist templates
  config.local.json       # local runtime config (gitignored)
  schedule.env            # local scheduler env (gitignored)
  state.local.json        # runtime state (gitignored)
  logs/                   # runtime logs/reports source (gitignored)
  reports/                # archived reports (gitignored)
```

## 1) Prepare config

Copy template and fill real values:

```bash
cp scripts/liquidity-bot/templates/config.example.json scripts/liquidity-bot/config.local.json
```

Required:

- `baseUrl`: API base URL, for example `https://api.clawnetd.com`
- `apiKey`: value for `X-API-Key`
- `accounts.liquidityVault.did/passphrase`
- `accounts.maker.did/passphrase`
- `accounts.taker.did/passphrase`
- Quick bootstrap mode: set `accounts.*.did` to `auto:self`, and the bot resolves node DID from `GET /api/v1/node`

Optional (risk reserve batch compensation):

- `accounts.riskReserve.did/passphrase`
- `reserve.defaultSender` (`riskReserve` or `liquidityVault`)
- `reserve.maxPerTransfer`
- `reserve.maxBatchTotal`

## 2) Scheduler env file (recommended)

Create one machine-specific env file:

```bash
cp scripts/liquidity-bot/templates/schedule.env.example scripts/liquidity-bot/schedule.env
```

Edit at least:

- `ROOT`
- `LIQUIDITY_BOT_CONFIG`
- `LIQUIDITY_BOT_LOG_DIR`
- `LIQUIDITY_REPORT_STORE_DIR`

All scheduler wrappers auto-load:

- `LIQUIDITY_BOT_ENV_FILE` (if set), otherwise `scripts/liquidity-bot/schedule.env`

## 3) Run step-by-step

```bash
node scripts/liquidity-bot/cli/health-check.mjs --config scripts/liquidity-bot/config.local.json
node scripts/liquidity-bot/cli/fund-operators.mjs --config scripts/liquidity-bot/config.local.json
node scripts/liquidity-bot/cli/publish-listings.mjs --config scripts/liquidity-bot/config.local.json --count 2
node scripts/liquidity-bot/cli/trade-cycles.mjs --config scripts/liquidity-bot/config.local.json --cycles 3
node scripts/liquidity-bot/cli/reconcile.mjs --config scripts/liquidity-bot/config.local.json
```

## 4) Run one-shot

```bash
node scripts/liquidity-bot/cli/run-once.mjs --config scripts/liquidity-bot/config.local.json --count 2 --cycles 3
```

Optional flags:

- `--skip-publish`
- `--skip-reconcile`

## Notes

- State is persisted to `stateFile` in config.
- All write calls include `did`, `passphrase`, and monotonically increasing `nonce`.
- The script targets `/api/v1/...` routes only.

## 5) Risk reserve batch compensation

Input template:

```bash
scripts/liquidity-bot/templates/reserve-compensation.example.csv
```

Dry-run (default):

```bash
pnpm liq:reserve \
  --config scripts/liquidity-bot/config.local.json \
  --input scripts/liquidity-bot/templates/reserve-compensation.example.csv \
  --incident-id INC-2026-02-001 \
  --memo-prefix reserve-compensation
```

Execute transfers:

```bash
pnpm liq:reserve \
  --config scripts/liquidity-bot/config.local.json \
  --input ./payouts.csv \
  --execute \
  --from-account riskReserve \
  --max-per-transfer 200 \
  --max-batch-total 2000
```

Output:

- JSON report + CSV report are written to `scripts/liquidity-bot/logs/`.
- On failure, row-level `error` detail is recorded in the report.

## 6) Incident daily report (group by incidentId)

Generate report for today (UTC, default):

```bash
pnpm liq:reserve:report
```

Generate report for a specific UTC date:

```bash
pnpm liq:reserve:report --date 2026-02-25
```

Include dry-run files/rows:

```bash
pnpm liq:reserve:report --date 2026-02-25 --include-dry-run true
```

Report output:

- JSON + CSV are written under `scripts/liquidity-bot/logs/`.
- CSV is one row per `incidentId` with totals/success/failure metrics.
- Use `LIQUIDITY_REPORT_STORE_DIR` (or wrapper positional arg) to persist into a specific directory.

## 7) Incident weekly/monthly report

Generate weekly report (default uses previous week anchor):

```bash
scripts/liquidity-bot/run/run-weekly-report.sh
```

Generate monthly report (default uses previous month anchor):

```bash
scripts/liquidity-bot/run/run-monthly-report.sh
```

Direct command mode:

```bash
pnpm liq:reserve:report:week -- --anchor-date 2026-02-25 --week-start monday
pnpm liq:reserve:report:month -- --anchor-date 2026-02-25
```

## 8) Scheduling templates

### cron (Linux/macOS)

Template file:

```bash
scripts/liquidity-bot/templates/cron.example
```

Quick install:

```bash
crontab -e
# 1) set LIQUIDITY_BOT_ENV_FILE
# 2) paste tasks from scripts/liquidity-bot/templates/cron.example
```

### launchd (macOS)

Template files:

```bash
scripts/liquidity-bot/templates/launchd/com.clawnet.liquidity-bot.plist.example
scripts/liquidity-bot/templates/launchd/com.clawnet.reserve-daily-report.plist.example
scripts/liquidity-bot/templates/launchd/com.clawnet.reserve-weekly-report.plist.example
scripts/liquidity-bot/templates/launchd/com.clawnet.reserve-monthly-report.plist.example
```

Install example (liquidity bot):

```bash
cp scripts/liquidity-bot/templates/launchd/com.clawnet.liquidity-bot.plist.example ~/Library/LaunchAgents/com.clawnet.liquidity-bot.plist
# edit LIQUIDITY_BOT_ENV_FILE in plist first
launchctl unload ~/Library/LaunchAgents/com.clawnet.liquidity-bot.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.clawnet.liquidity-bot.plist
launchctl start com.clawnet.liquidity-bot
```

Install example (daily report):

```bash
cp scripts/liquidity-bot/templates/launchd/com.clawnet.reserve-daily-report.plist.example ~/Library/LaunchAgents/com.clawnet.reserve-daily-report.plist
# edit LIQUIDITY_BOT_ENV_FILE in plist first
launchctl unload ~/Library/LaunchAgents/com.clawnet.reserve-daily-report.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.clawnet.reserve-daily-report.plist
launchctl start com.clawnet.reserve-daily-report
```

Install example (weekly report):

```bash
cp scripts/liquidity-bot/templates/launchd/com.clawnet.reserve-weekly-report.plist.example ~/Library/LaunchAgents/com.clawnet.reserve-weekly-report.plist
# edit LIQUIDITY_BOT_ENV_FILE in plist first
launchctl unload ~/Library/LaunchAgents/com.clawnet.reserve-weekly-report.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.clawnet.reserve-weekly-report.plist
launchctl start com.clawnet.reserve-weekly-report
```

Install example (monthly report):

```bash
cp scripts/liquidity-bot/templates/launchd/com.clawnet.reserve-monthly-report.plist.example ~/Library/LaunchAgents/com.clawnet.reserve-monthly-report.plist
# edit LIQUIDITY_BOT_ENV_FILE in plist first
launchctl unload ~/Library/LaunchAgents/com.clawnet.reserve-monthly-report.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.clawnet.reserve-monthly-report.plist
launchctl start com.clawnet.reserve-monthly-report
```

### Shared wrappers

Scheduler wrappers:

```bash
scripts/liquidity-bot/run/run-scheduled.sh
scripts/liquidity-bot/run/run-daily-report.sh
scripts/liquidity-bot/run/run-weekly-report.sh
scripts/liquidity-bot/run/run-monthly-report.sh
```

Examples:

```bash
scripts/liquidity-bot/run/run-scheduled.sh
scripts/liquidity-bot/run/run-scheduled.sh /absolute/path/to/config.local.json --count 1 --cycles 2
scripts/liquidity-bot/run/run-daily-report.sh
scripts/liquidity-bot/run/run-daily-report.sh /absolute/path/to/report-archive-dir
scripts/liquidity-bot/run/run-weekly-report.sh
scripts/liquidity-bot/run/run-monthly-report.sh
```
