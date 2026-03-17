# Liquidity Bot 操作手册（可直接执行）

本文是 `scripts/liquidity-bot/` 的一线执行文档，按“准备 -> 运行 -> 定时 -> 排障”组织。

## 1. 你会用到的脚本

| 步骤     | 文件                   | 作用                                         | 快捷命令             |
| -------- | ---------------------- | -------------------------------------------- | -------------------- |
| 健康检查 | `cli/health-check.mjs` | 检查节点状态与 vault/maker/taker 余额        | `pnpm liq:health`    |
| 补仓     | `cli/fund-operators.mjs` | 从流动性金库补 maker/taker 到目标余额      | `pnpm liq:fund`      |
| 挂单     | `cli/publish-listings.mjs` | 发布 Info 市场测试 listing（支持 `--count`） | `pnpm liq:publish` |
| 交易闭环 | `cli/trade-cycles.mjs` | 执行 买入 -> 交付 -> 确认（支持 `--cycles`） | `pnpm liq:trade`     |
| 回笼     | `cli/reconcile.mjs`    | 将 maker/taker 超过保留额部分回笼到金库      | `pnpm liq:reconcile` |
| 风险补偿 | `cli/reserve-compensate.mjs` | 批量补偿（CSV/JSON 输入，支持 dry-run） | `pnpm liq:reserve`   |
| 日报汇总 | `cli/reserve-daily-report.mjs` | 按 incidentId 聚合补偿日报（JSON/CSV） | `pnpm liq:reserve:report` |
| 周月汇总 | `cli/reserve-period-report.mjs` | 按周/按月聚合 incident 汇总（JSON/CSV） | `pnpm liq:reserve:report:period` |
| 一键流程 | `cli/run-once.mjs`     | 串行执行完整流程（支持跳过步骤）             | `pnpm liq:run`       |

核心流程实现在 `scripts/liquidity-bot/lib/steps.mjs`，配置与请求封装在 `scripts/liquidity-bot/lib/bot-lib.mjs`。

## 2. 准备配置（首次必做）

1. 复制模板

```bash
cp scripts/liquidity-bot/templates/config.example.json scripts/liquidity-bot/config.local.json
```

2. 填写关键项

- `baseUrl`：例如 `http://127.0.0.1:9528` 或你的网关地址
- `apiKey`：用于 `X-API-Key`
- `accounts.liquidityVault.did/passphrase`
- `accounts.maker.did/passphrase`
- `accounts.taker.did/passphrase`
- `accounts.riskReserve.did/passphrase`（若要独立执行风险补偿）
- 快速启动可将 `accounts.*.did` 设为 `auto:self`，脚本会从 `GET /api/v1/node` 自动解析节点 DID
- `reserve.defaultSender/maxPerTransfer/maxBatchTotal`（可选护栏）

3. 校验本地敏感文件不会入库

- `scripts/liquidity-bot/config.local.json`
- `scripts/liquidity-bot/schedule.env`
- `scripts/liquidity-bot/state.local.json`
- `scripts/liquidity-bot/logs/`

以上已在根目录 `.gitignore` 中忽略。

4. 配置调度环境文件（跨设备建议）

```bash
cp scripts/liquidity-bot/templates/schedule.env.example scripts/liquidity-bot/schedule.env
```

至少填写：

- `ROOT`
- `LIQUIDITY_BOT_CONFIG`
- `LIQUIDITY_BOT_LOG_DIR`
- `LIQUIDITY_REPORT_STORE_DIR`

所有调度 wrapper 都会自动加载：

- `LIQUIDITY_BOT_ENV_FILE`（若设置）
- 否则默认 `scripts/liquidity-bot/schedule.env`

## 3. 最短路径（一键跑通）

```bash
node scripts/liquidity-bot/cli/run-once.mjs \
  --config scripts/liquidity-bot/config.local.json \
  --count 2 \
  --cycles 3
```

可选参数：

- `--skip-publish`：跳过挂单（复用历史 listing）
- `--skip-reconcile`：跳过回笼（调试时常用）

## 4. 分步执行（便于定位问题）

```bash
node scripts/liquidity-bot/cli/health-check.mjs --config scripts/liquidity-bot/config.local.json
node scripts/liquidity-bot/cli/fund-operators.mjs --config scripts/liquidity-bot/config.local.json
node scripts/liquidity-bot/cli/publish-listings.mjs --config scripts/liquidity-bot/config.local.json --count 2
node scripts/liquidity-bot/cli/trade-cycles.mjs --config scripts/liquidity-bot/config.local.json --cycles 3
node scripts/liquidity-bot/cli/reconcile.mjs --config scripts/liquidity-bot/config.local.json
```

## 5. 风险储备批量补偿（SOP）

1. 准备输入文件（CSV 或 JSON）

CSV 模板：`scripts/liquidity-bot/templates/reserve-compensation.example.csv`

字段建议：

- `to`：收款 DID/地址（必填）
- `amount`：补偿金额，正整数（必填）
- `memo`：补偿说明（可选）
- `incidentId`：事故编号（可选）
- `requestId`：工单编号（可选）

2. 先 dry-run（默认即 dry-run）

```bash
pnpm liq:reserve \
  --config scripts/liquidity-bot/config.local.json \
  --input scripts/liquidity-bot/templates/reserve-compensation.example.csv \
  --incident-id INC-2026-02-001 \
  --memo-prefix reserve-comp
```

3. 再执行真实发放

```bash
pnpm liq:reserve \
  --config scripts/liquidity-bot/config.local.json \
  --input ./payouts.csv \
  --execute \
  --from-account riskReserve \
  --max-per-transfer 200 \
  --max-batch-total 2000
```

4. 查看结果报告

- 默认输出到 `scripts/liquidity-bot/logs/`
- 同时写入 JSON + CSV 两份结果，包含 `status/txHash/error/nonce`
- 发生失败时，脚本返回非 0，并在报告中保留失败行

## 6. incidentId 聚合补偿日报（SOP）

1. 生成当天日报（UTC）

```bash
pnpm liq:reserve:report
```

2. 生成指定日期日报（UTC）

```bash
pnpm liq:reserve:report --date 2026-02-25
```

3. 包含 dry-run 数据（默认不含）

```bash
pnpm liq:reserve:report --date 2026-02-25 --include-dry-run true
```

4. 结果说明

- 默认从 `scripts/liquidity-bot/logs/` 扫描 `reserve-compensation*.json`
- 输出 JSON + CSV 到日志目录
- CSV 按 incidentId 一行汇总：请求总额、成功/失败笔数、成功/失败金额、唯一收款方数量等

## 7. 定时运行（生产建议）

统一入口：

- 交易机器人：`scripts/liquidity-bot/run/run-scheduled.sh`
- 日报归档：`scripts/liquidity-bot/run/run-daily-report.sh`
- 周报归档：`scripts/liquidity-bot/run/run-weekly-report.sh`
- 月报归档：`scripts/liquidity-bot/run/run-monthly-report.sh`

关键环境变量（日报归档）：

- `LIQUIDITY_REPORT_SOURCE_LOG_DIR`：补偿结果日志源目录（默认 `scripts/liquidity-bot/logs`）
- `LIQUIDITY_REPORT_STORE_DIR`：日报文件落盘目录（建议挂载到持久卷/共享盘）
- `LIQUIDITY_REPORT_INCLUDE_DRY_RUN`：是否纳入 dry-run（默认 `false`）
- `LIQUIDITY_WEEK_START`：周起始日（`monday` / `sunday`，默认 `monday`）

### 7.1 cron

```bash
crontab -e
# 贴入 scripts/liquidity-bot/templates/cron.example 内容，并改 LIQUIDITY_BOT_ENV_FILE
```

### 7.2 macOS launchd

交易机器人：

```bash
cp scripts/liquidity-bot/templates/launchd/com.clawnet.liquidity-bot.plist.example \
  ~/Library/LaunchAgents/com.clawnet.liquidity-bot.plist

# 先修改 plist 里的 LIQUIDITY_BOT_ENV_FILE
launchctl unload ~/Library/LaunchAgents/com.clawnet.liquidity-bot.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.clawnet.liquidity-bot.plist
launchctl start com.clawnet.liquidity-bot
```

日报归档：

```bash
cp scripts/liquidity-bot/templates/launchd/com.clawnet.reserve-daily-report.plist.example \
  ~/Library/LaunchAgents/com.clawnet.reserve-daily-report.plist

# 先修改 plist 里的 LIQUIDITY_BOT_ENV_FILE
launchctl unload ~/Library/LaunchAgents/com.clawnet.reserve-daily-report.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.clawnet.reserve-daily-report.plist
launchctl start com.clawnet.reserve-daily-report
```

周报归档：

```bash
cp scripts/liquidity-bot/templates/launchd/com.clawnet.reserve-weekly-report.plist.example \
  ~/Library/LaunchAgents/com.clawnet.reserve-weekly-report.plist

# 先修改 plist 里的 LIQUIDITY_BOT_ENV_FILE
launchctl unload ~/Library/LaunchAgents/com.clawnet.reserve-weekly-report.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.clawnet.reserve-weekly-report.plist
launchctl start com.clawnet.reserve-weekly-report
```

月报归档：

```bash
cp scripts/liquidity-bot/templates/launchd/com.clawnet.reserve-monthly-report.plist.example \
  ~/Library/LaunchAgents/com.clawnet.reserve-monthly-report.plist

# 先修改 plist 里的 LIQUIDITY_BOT_ENV_FILE
launchctl unload ~/Library/LaunchAgents/com.clawnet.reserve-monthly-report.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.clawnet.reserve-monthly-report.plist
launchctl start com.clawnet.reserve-monthly-report
```

### 7.3 手动触发一次（验配置）

```bash
scripts/liquidity-bot/run/run-scheduled.sh \
  /absolute/path/to/config.local.json \
  --count 1 \
  --cycles 2

scripts/liquidity-bot/run/run-daily-report.sh \
  /absolute/path/to/report-archive-dir

scripts/liquidity-bot/run/run-weekly-report.sh \
  /absolute/path/to/report-archive-dir/weekly

scripts/liquidity-bot/run/run-monthly-report.sh \
  /absolute/path/to/report-archive-dir/monthly
```

## 8. 周报/月报聚合（SOP）

1. 周报（默认汇总“上一完整周”）

```bash
scripts/liquidity-bot/run/run-weekly-report.sh
```

2. 月报（默认汇总“上一完整月”）

```bash
scripts/liquidity-bot/run/run-monthly-report.sh
```

3. 自定义锚点日期（UTC）

```bash
LIQUIDITY_WEEKLY_ANCHOR_DATE_UTC=2026-02-25 scripts/liquidity-bot/run/run-weekly-report.sh
LIQUIDITY_MONTHLY_ANCHOR_DATE_UTC=2026-02-25 scripts/liquidity-bot/run/run-monthly-report.sh
```

4. 直接命令模式（不走 wrapper）

```bash
pnpm liq:reserve:report:week -- --anchor-date 2026-02-25 --week-start monday
pnpm liq:reserve:report:month -- --anchor-date 2026-02-25
```

## 9. 运行前检查清单

- 节点可访问：`GET /api/v1/node` 正常
- `apiKey` 有权限访问写接口
- 三个 DID 的 `passphrase` 正确
- 风险补偿前，确认 `reserve` 护栏（单笔上限、批次上限）
- 确认 `LIQUIDITY_REPORT_STORE_DIR` 已指向持久化目录
- `funding.maxTransferPerRun` 足够但不过大
- 回笼阈值 `funding.reconcileMinKeep` 与运营策略一致

## 10. 常见故障与处理

- `Config not found`：先复制 `templates/config.example.json` 到 `config.local.json`
- `Invalid --count/--cycles`：参数必须是正整数
- `Missing required --input`：风险补偿脚本必须提供批量文件
- `parseErrorCount > 0`：日志目录里存在非补偿报告 JSON 或损坏 JSON，按 `parseErrors` 排查
- 周报/月报结果为空：检查源日志是否包含对应时间范围的 `reserve-compensation*.json`
- `Top-up ... exceeds maxTransferPerRun`：提高 `maxTransferPerRun` 或降低目标余额
- `Batch total ... exceeds maxBatchTotal`：分批执行或调整护栏
- `Key unavailable`：DID/passphrase 不匹配或目标节点无该账户密钥
- API `401/403`：检查 `apiKey`、网关鉴权与来源 IP 限制

## 11. 推荐操作节奏

1. 先跑一次 `health-check` 看余额和节点状态。
2. 用 `run-once` 执行 `--count 1 --cycles 1` 做小流量验收。
3. 确认无异常后再提高 `count/cycles`。
4. 最后接入 cron/launchd，按小时级节奏运行。
