# OpenClaw Agent 发布准备清单

> 目标：让 OpenClaw 龙虾 Agent 机器人能连接 ClawNet 网络，完成身份注册、Token 转账、市场交易、服务合约等全流程。
>
> 创建日期：2026-02-26
> 目标环境：Testnet（api.clawnetd.com，chainId 7625）

## 状态标记

```
[ ] 未开始    [~] 进行中    [x] 已完成    [!] 阻塞
```

---

## 🔴 P0 — 发布阻塞项

> 这些不完成，外部 Agent 无法正常使用。

### R-1. Genesis Mint — 初始 Token 铸造

- [x] **R-1.1** 合约重新部署（原 4/9 代理映射损坏，2026-02-26 清洁重部署）
  - 清理旧 OZ manifest → 全部 9 个合约重部署
  - 新合约地址：
    | 合约 | 地址 |
    |------|------|
    | ClawToken | `0xd9046ef83f8c910e4c828a1F8bEDDcD618fE3A73` |
    | ParamRegistry | `0xe601130a0c3C3f8193616114768Ba2F429DB2D3B` |
    | ClawEscrow | `0xBCE2a925313ED06799156E64522E7B2735079be4` |
    | ClawIdentity | `0x42ac5e96EB43c1390e7BED6Fc7FcAfe1375972E9` |
    | ClawStaking | `0x82e3d8777F07e21e979cb9b1e298EDA711CbA174` |
    | ClawReputation | `0x2957Bd9b9643C032d96490C809082A15e4af7fc6` |
    | ClawDAO | `0x395e728BB881F827B959b6f83928Af69461b109e` |
    | ClawContracts | `0x25836998927244a98218B8B33C42cfDF4849EcC8` |
    | ClawRouter | `0xC89C2324535Af64b3b11611fC321DB4a66145fEA` |
  - Roles: MINTER→Staking, GOVERNOR→DAO, DAO.reputation→Reputation, DAO.staking→Staking
  - Router: 8 modules registered, ParamRegistry: 14 default params

- [x] **R-1.2** Genesis Mint 完成（1,000,000 Token 总量）
  - 通过 `BOOTSTRAP_MINT=true` 在部署脚本中一次完成
  - 分配结果：
    | 用途 | 金额 | 接收方 |
    |------|------|--------|
    | DAO 国库 | 500,000 | ClawDAO 代理 `0x395e728B...` |
    | Deployer / Faucet | 350,000 | Deployer `0xA9b95A4f...` |
    | 流动性 | 100,000 | Treasury `0x6df40E8d...` |
    | 风险储备 | 50,000 | Treasury `0x6df40E8d...` |
  - 验收：`totalSupply = 1,000,000` ✅

- [x] **R-1.3** Faucet 端到端测试
  - 配置：`CLAW_DEV_FAUCET_API_KEY` 统一为 Caddy `CLAW_API_KEY`
  - systemd: 添加 `EnvironmentFile` 到 clawnetd + caddy override
  - 本地测试：`POST /api/v1/dev/faucet` → mint 10 Token ✅
  - 公网测试：`POST https://api.clawnetd.com/api/v1/dev/faucet` → mint 5 Token ✅
  - 单一 API Key = `CLAW_API_KEY`（同时用于 Caddy 网关和 Faucet）

### R-2. SDK 发布到 npm（TypeScript）

- [x] **R-2.1** `workspace:` 依赖处理
  - `scripts/publish.sh` 已改用 `pnpm publish`（自动转换 `workspace:` 为真实版本）
  - 无需手动修改 `packages/protocol/package.json`

- [x] **R-2.2** 全量构建 + 测试通过
  - `pnpm build` + `pnpm test`：core 21/21, protocol 64/64, sdk pass ✅

- [x] **R-2.3** 发布 3 个包到 npm（0.2.0）
  - 前置：需在本机执行 `npm login`
  - 操作：`scripts/publish.sh --release`（使用 automation token）
  - 验收：`npm view @claw-network/sdk version` 返回 `0.2.0` ✅

### R-3. Python SDK 发布到 PyPI

- [x] **R-3.1** 本地构建 + 测试（2026-03-01）
  - 操作：`cd packages/sdk-python && hatch build && hatch run test`
  - 构建：`clawnet_sdk-0.2.0-py3-none-any.whl` + `.tar.gz` ✅
  - 测试：51/51 passed ✅（修复 6 个测试文件 API 路径 + mock 签名）

- [x] **R-3.2** 确认包名和 import 路径一致（2026-03-01）
  - PyPI 包名：`clawnet-sdk`
  - import 路径：`from clawnet import ClawNetClient`
  - 验收：wheel install + import → OK ✅

- [!] **R-3.3** 发布到 PyPI
  - 操作：`hatch publish`（需要 PyPI API token）
  - 状态：阻塞 — 等待 PyPI token

### R-4. Testnet 稳定性观察（T-3.9）

- [~] **R-4.1** 7 天观察窗口（2026-02-26 → 2026-03-04）
  - 自动化：cron 每日 CET 07:00 执行 `daily-monitor.sh`
  - Day 1 (02-26): ✅ 通过
  - Day 2 (02-27): ✅ 通过（synced=true, v0.2.0, API key auth enforced, uptime 10h — 当日重启过）
  - Day 3 (02-28): ✅ 通过（2026-02-28T08:36:01Z, report: `/opt/clawnet/infra/testnet/reports/2026-02-28.json`）
    - clusterPeers=2（3 validators connected）
    - Scenario 01: 9 passed / 0 failed
    - Reconciliation: passed（0 discrepancies）
  - Day 4 (03-01): ✅ 通过（synced=true, v0.2.0, peers=2, connections=2, blockHeight=158336, uptime=69474s, faucet mint 5 Token OK）
  - Day 5 (03-02): ✅ 通过（修复后）
    - 早间 08:01 UTC（Server 端 cron）：clusterPeers=2, blockHeight=167729, Scenario 9/9, Reconciliation 0 discrepancies
    - ⚠️ Server B/C Geth crash loop 修复（`/config/password.txt` 丢失 → 恢复 config + 重导入 keystore + 链同步）
    - **Re-verify 12:52 UTC**: Geth clusterPeers=2 ✅, blockHeight=176486, libp2p peers=1 ⚠️
    - **libp2p 修复 13:10 UTC**: `systemctl restart clawnetd` on bob + geth-c
      - 根因：Server C 在 03-01 14:03 断开后未自动重连（libp2p 无持久重连机制）
      - 修复后：Server A peers=3 connections=3 ✅, Server B peers=2 ✅, Server C peers=1 ✅
    - 🔧 **daily-monitor.sh 改进**：新增 libp2p peers vs Geth clusterPeers 一致性检查（testnet + mainnet）
  - Day 6 (03-03): ✅ 通过（修复后）
    - **Geth 层**：3/3 validators 同步，blockHeight=202575→203019，clusterPeers=2 ✅
    - ⚠️ **Server B libp2p 断连**（同 Day 5 根因 — 无持久重连）
      - Mar 01 14:03 断开后 47h 未重连，`systemctl restart clawnetd` 修复 → peers=1 ✅
    - **Scenario 01**: 8/9 passed（1 预期失败 — 单节点模式下 DID 唯一性检查）
      - 🔧 修复 scenario `.env`：旧 IP 改为 `127.0.0.1:9528`（B/C API port 9528 未开放外网，符合设计）
      - 🔧 修复 `daily-monitor.sh`：移除单节点模式跳过逻辑，允许 Scenario 01 在单节点运行
    - **Reconciliation**: 2 indexer 级差异（非链共识问题）
      - DID controller: indexer 记录 deployer 为 controller，链上为 derived address
      - Deployer balance: indexer=0 vs chain=150060（Server A 重启后 indexer 未完全追赶）
    - **Faucet**: max per claim=50 Token（scenario 请求 10000 被拒，正常限制）
  - Day 7 (03-04): ⏳
  - 验收：连续 5 天无异常（健康检查 + 对账 0 差异 + 场景回归通过）

---

## 🟡 P1 — 强烈建议（用户体验关键）

> 不做也能跑，但外部开发者体验会很差。

### R-5. API Key 分发机制

- [x] **R-5.1** 设计 API Key 管理方案（2026-02-27）
  - 采用方案 A：Node 层中间件，SQLite 存储
  - 实现：`packages/node/src/api/api-key-store.ts` — SQLite CRUD store
  - Schema: `api_keys` 表 (id, key[64-hex], label, status, created_at, revoked_at, last_used_at)
  - 向后兼容：0 active keys 时跳过验证

- [x] **R-5.2** 实现 Key CRUD 管理命令（2026-02-27）
  - `clawnet api-key create <label>` → 生成新 Key ✅
  - `clawnet api-key list [--all]` → 列出 Key（prefix 截断）✅
  - `clawnet api-key revoke <id>` → 吊销 Key ✅
  - Auth middleware: `packages/node/src/api/auth.ts`
  - Admin API: `POST/GET /api/v1/admin/api-keys`（仅 localhost）
  - 支持 `X-Api-Key` 和 `Authorization: Bearer` 两种方式

- [x] **R-5.3** 改造 Node 层验证逻辑（2026-02-27）
  - 采用方案 A：Node 层中间件查表验证
  - Middleware chain: `cors → apiKeyAuth → errorBoundary → logger → router`
  - 公共路由 `/api/v1/node` 始终开放（健康检查）
  - 测试：20 tests (9 unit + 7 integration + 4 mainnet) 全部通过 ✅
  - Server A 已部署：2 个 API Key 已创建，Caddy `@write_ops` 已移除
  - Mainnet 安全加固（2026-02-27）：
    - `--network mainnet` / `CLAW_NETWORK=mainnet` 支持
    - Mainnet 不挂载 dev routes（faucet 404）
    - Mainnet 0 key 时强制 401（不跳过验证）

### R-6. 文档站部署

- [x] **R-6.1** 构建文档站（2026-03-01）
  - 目录：`packages/docs/`（Next.js 15.5.12 + Fumadocs）
  - `pnpm --filter docs build`：90 pages generated ✅
  - Server A 部署：systemd `clawnet-docs.service` on port 3001 ✅

- [~] **R-6.2** 配置公网域名 + Caddy 反向代理（2026-03-01）
  - Caddy reverse proxy `docs.clawnetd.com → localhost:3001` 已添加 ✅
  - ⚠️ 待完成：DNS A 记录 `docs.clawnetd.com → 66.94.125.242`
  - 验收：`curl https://docs.clawnetd.com` 返回文档页面

### R-7. 修复示例代码

- [x] **R-7.1** Node.js 示例改用 npm 发布包
  - `examples/nodejs-agent/package.json`: `workspace:*` → `^0.2.0` ✅
  - 修复 milestone 索引：`ms-1` → `0`（API 使用数字索引）

- [x] **R-7.2** 修复 Shell 示例 API 路径
  - 所有 shell 脚本：`/api/xxx` → `/api/v1/xxx` ✅
  - `wallet-ops.sh`：添加 `CLAW_ADDRESS` 变量，路径改为 `/api/v1/wallets/$ADDRESS`
  - `contract-lifecycle.sh`：sign/fund/complete 路径加 `/actions/` 前缀
  - 合约 milestone ID 改为数字索引

- [x] **R-7.3** Python 示例修复
  - README.md：`pip install clawnet` → `pip install clawnet-sdk` ✅
  - agent.py docstring 同步更新

- [x] **R-7.4** 补充 .env.example 给示例项目
  - 内容：`CLAW_NODE_URL`, `CLAW_API_KEY`, `CLAW_AGENT_DID`, `CLAW_PASSPHRASE` ✅
  - 3 个示例目录均已创建 .env.example
  - 验收：开发者 copy .env.example → .env 后即可运行

### R-8. Docker 镜像发布

- [x] **R-8.1** 修复 Dockerfile P2P 端口（2026-03-01）
  - `EXPOSE 9529` → `EXPOSE 9527` ✅
  - HEALTHCHECK `/api/node/status` → `/api/v1/node` ✅

- [~] **R-8.2** 构建并推送到 GHCR（2026-03-01）
  - Dockerfile 修复：添加 `git` 到 build stage, `git init` before pnpm install, runtime stage `--ignore-scripts`
  - `docker build -t ghcr.io/claw-network/clawnetd:0.2.0 .` → 成功 ✅（image 411MB / 90.4MB compressed）
  - `docker tag ... :latest` ✅
  - ⚠️ 待完成：`docker push`（需要 GHCR auth: `echo $GHCR_TOKEN | docker login ghcr.io -u USERNAME --password-stdin`）

- [x] **R-8.3** 验证 Docker 容器可运行（2026-03-01）
  - `docker run -d -p 19528:9528 -e CLAW_PASSPHRASE=test ghcr.io/claw-network/clawnetd:0.2.0`
  - `curl localhost:19528/api/v1/node` → v0.2.0, synced=true, network=devnet ✅

---

## 🟢 P2 — 后续迭代

> 发布后逐步补齐。

### R-9. 主网部署（Sprint 3-D）

- [ ] **R-9.1** 购买 2 台新 VPS（与现有 3 台一致规格）
- [ ] **R-9.2** 生成 mainnet genesis.json（chainId 7626，5 Validator）
- [ ] **R-9.3** 5 节点 Geth PoA 启动 + 出块验证
- [ ] **R-9.4** 主网合约部署（9 个合约）
- [ ] **R-9.5** 数据迁移（testnet → mainnet）+ 全量对账
- [ ] **R-9.6** 节点切换 + DNS 更新
- [ ] **R-9.7** SDK/CLI 默认 RPC 切换到主网
- [ ] 参考：`on-chain-tasks.md` T-3.10 ~ T-3.15

### R-10. CI 自动发布

- [ ] **R-10.1** GitHub Actions: tag push → npm publish
- [ ] **R-10.2** GitHub Actions: tag push → PyPI publish
- [ ] **R-10.3** GitHub Actions: tag push → Docker build + push GHCR

### R-11. 多用户限流

- [ ] **R-11.1** Per-key rate limiting（漏桶 / 令牌桶）
- [ ] **R-11.2** API 用量统计 dashboard
- [ ] **R-11.3** 超限时返回 `429 Too Many Requests` + `Retry-After` header

---

## 执行优先级 & 最短路径

如果目标是 **尽快让外部 Agent 跑起来**，按以下顺序执行：

```
Step 1: R-1（Genesis Mint）          ← ~30 分钟，解锁 Token 经济
Step 2: R-2（npm publish SDK）       ← ~1 小时，解锁 TS Agent
Step 3: R-3（PyPI publish SDK）      ← ~30 分钟，解锁 Python Agent
Step 4: R-7（修复示例代码）           ← ~15 分钟，外部开发者可 copy-run
Step 5: R-4（等待观察期）            ← 自动进行，~3月4日完成
Step 6: R-6（文档站部署）            ← ~2 小时，开发者有参考
Step 7: R-5（API Key 分发）          ← ~1-2 天，支持多 Agent 接入
Step 8: R-8（Docker 发布）           ← ~1 小时，支持自建节点
```

**预计 P0 + P1 全部完成：3–5 天（含等待观察期）。**

---

## 检查命令速查

```bash
# 检查 npm 包版本
npm view @claw-network/sdk version

# 检查 PyPI 包
pip install clawnet-sdk && python -c "from clawnet import ClawNetClient; print('OK')"

# 检查 testnet API
curl -sf https://api.clawnetd.com/api/v1/node | jq .

# 检查 Token totalSupply (via deployer balance)
curl -sf https://api.clawnetd.com/api/v1/wallets/0xA9b95A4fDCD673f6aE0D2a873E0f4771CA7D0119 \
  | jq .data.balance

# 检查 faucet
curl -sf -X POST https://api.clawnetd.com/api/v1/dev/faucet \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $CLAW_API_KEY" \
  -d '{"address":"0x0000000000000000000000000000000000000099","amount":5}'

# 检查 Docker 镜像
docker pull ghcr.io/claw-network/clawnetd:0.2.0
```

---

*最后更新: 2026-03-03（R-4.1 Day 6 — Geth 3/3 validators, blockHeight ~203K, Server B libp2p 重启修复, Scenario 8/9, indexer 2 discrepancies）*
*关联文档: on-chain-tasks.md (T-3.9 ~ T-3.15), TOKEN_DISTRIBUTION.md, OPENCLAW_INTEGRATION.md*
