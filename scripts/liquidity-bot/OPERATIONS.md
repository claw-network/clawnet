# Liquidity Bot 操作手册（可直接执行）

本文是 `scripts/liquidity-bot/` 的一线执行文档，按“准备 -> 运行 -> 定时 -> 排障”组织。

## 1. 你会用到的脚本

| 步骤     | 文件                   | 作用                                         | 快捷命令             |
| -------- | ---------------------- | -------------------------------------------- | -------------------- |
| 健康检查 | `health-check.mjs`     | 检查节点状态与 vault/maker/taker 余额        | `pnpm liq:health`    |
| 补仓     | `fund-operators.mjs`   | 从流动性金库补 maker/taker 到目标余额        | `pnpm liq:fund`      |
| 挂单     | `publish-listings.mjs` | 发布 Info 市场测试 listing（支持 `--count`） | `pnpm liq:publish`   |
| 交易闭环 | `trade-cycles.mjs`     | 执行 买入 -> 交付 -> 确认（支持 `--cycles`） | `pnpm liq:trade`     |
| 回笼     | `reconcile.mjs`        | 将 maker/taker 超过保留额部分回笼到金库      | `pnpm liq:reconcile` |
| 一键流程 | `run-once.mjs`         | 串行执行完整流程（支持跳过步骤）             | `pnpm liq:run`       |

核心流程实现在 `scripts/liquidity-bot/steps.mjs`，配置与请求封装在 `scripts/liquidity-bot/bot-lib.mjs`。

## 2. 准备配置（首次必做）

1. 复制模板

```bash
cp scripts/liquidity-bot/config.example.json scripts/liquidity-bot/config.local.json
```

2. 填写关键项

- `baseUrl`：例如 `http://127.0.0.1:9528` 或你的网关地址
- `apiKey`：用于 `X-API-Key`
- `accounts.liquidityVault.did/passphrase`
- `accounts.maker.did/passphrase`
- `accounts.taker.did/passphrase`

3. 校验本地敏感文件不会入库

- `scripts/liquidity-bot/config.local.json`
- `scripts/liquidity-bot/state.local.json`
- `scripts/liquidity-bot/logs/`

以上已在根目录 `.gitignore` 中忽略。

## 3. 最短路径（一键跑通）

```bash
node scripts/liquidity-bot/run-once.mjs \
  --config scripts/liquidity-bot/config.local.json \
  --count 2 \
  --cycles 3
```

可选参数：

- `--skip-publish`：跳过挂单（复用历史 listing）
- `--skip-reconcile`：跳过回笼（调试时常用）

## 4. 分步执行（便于定位问题）

```bash
node scripts/liquidity-bot/health-check.mjs --config scripts/liquidity-bot/config.local.json
node scripts/liquidity-bot/fund-operators.mjs --config scripts/liquidity-bot/config.local.json
node scripts/liquidity-bot/publish-listings.mjs --config scripts/liquidity-bot/config.local.json --count 2
node scripts/liquidity-bot/trade-cycles.mjs --config scripts/liquidity-bot/config.local.json --cycles 3
node scripts/liquidity-bot/reconcile.mjs --config scripts/liquidity-bot/config.local.json
```

## 5. 定时运行（生产建议）

统一入口：`scripts/liquidity-bot/run-scheduled.sh`

- 默认配置路径：`LIQUIDITY_BOT_CONFIG` 或 `scripts/liquidity-bot/config.local.json`
- 默认日志目录：`LIQUIDITY_BOT_LOG_DIR` 或 `scripts/liquidity-bot/logs`
- 支持透传参数：例如 `--count 1 --cycles 2`

### 5.1 cron

```bash
crontab -e
# 贴入 scripts/liquidity-bot/cron.example 内容，并改 ROOT
```

### 5.2 macOS launchd

```bash
cp scripts/liquidity-bot/com.clawnet.liquidity-bot.plist.example \
  ~/Library/LaunchAgents/com.clawnet.liquidity-bot.plist

# 先修改 plist 里的绝对路径
launchctl unload ~/Library/LaunchAgents/com.clawnet.liquidity-bot.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.clawnet.liquidity-bot.plist
launchctl start com.clawnet.liquidity-bot
```

### 5.3 手动触发一次（验配置）

```bash
scripts/liquidity-bot/run-scheduled.sh \
  /absolute/path/to/config.local.json \
  --count 1 \
  --cycles 2
```

## 6. 运行前检查清单

- 节点可访问：`GET /api/v1/node` 正常
- `apiKey` 有权限访问写接口
- 三个 DID 的 `passphrase` 正确
- `funding.maxTransferPerRun` 足够但不过大
- 回笼阈值 `funding.reconcileMinKeep` 与运营策略一致

## 7. 常见故障与处理

- `Config not found`：先复制 `config.example.json` 到 `config.local.json`
- `Invalid --count/--cycles`：参数必须是正整数
- `Top-up ... exceeds maxTransferPerRun`：提高 `maxTransferPerRun` 或降低目标余额
- `Key unavailable`：DID/passphrase 不匹配或目标节点无该账户密钥
- API `401/403`：检查 `apiKey`、网关鉴权与来源 IP 限制

## 8. 推荐操作节奏

1. 先跑一次 `health-check` 看余额和节点状态。
2. 用 `run-once` 执行 `--count 1 --cycles 1` 做小流量验收。
3. 确认无异常后再提高 `count/cycles`。
4. 最后接入 cron/launchd，按小时级节奏运行。
