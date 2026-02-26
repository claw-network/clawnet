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

- [ ] **R-1.1** 确认 testnet 合约地址和 deployer 账户状态
  - 合约地址：`0xA98Cc076321aF8cC66A579b91643B5B98E316AA4`（ClawToken）
  - Deployer 需要持有 `MINTER_ROLE`
  - 验收：`ClawToken.hasRole(MINTER_ROLE, deployer)` 返回 true

- [ ] **R-1.2** 执行初始铸造（按 TOKEN_DISTRIBUTION.md 分配比例）
  - 操作：`npx hardhat console --network clawnetTestnet`
  - 分配方案（100 万 Token 总量）：
    | 用途 | 比例 | 金额 | 接收方 |
    |------|------|------|--------|
    | DAO 国库 | 50% | 500,000 | DAO 合约地址 |
    | 节点 A/B/C | 各 50,000 | 150,000 | 3 台节点钱包 |
    | Faucet 运营 | 15% | 150,000 | Faucet 钱包 |
    | 流动性 | 10% | 100,000 | 流动性钱包 |
    | 风险储备 | 5% | 50,000 | 储备钱包 |
    | 生态拨款余量 | — | 50,000 | 预留 |
  - 验收：`ClawToken.totalSupply()` = 1,000,000

- [ ] **R-1.3** Faucet 端到端测试
  - 操作：`POST /api/dev/faucet` 请求领取 Token
  - 验收：新 DID 调用后余额 > 0

### R-2. SDK 发布到 npm（TypeScript）

- [ ] **R-2.1** 修复 `@claw-network/protocol` 的 `workspace:` 依赖
  - 文件：`packages/protocol/package.json`
  - 将 `"@claw-network/core": "workspace:^0.1.0"` 改为 `"@claw-network/core": "^0.2.0"`
  - 验收：`npm pack` 后 tarball 中的 package.json 无 `workspace:` 引用

- [ ] **R-2.2** 全量构建 + 测试通过
  - 操作：`pnpm build && pnpm test`
  - 验收：0 error, 0 fail

- [ ] **R-2.3** 发布 3 个包到 npm（0.2.0）
  - 顺序：`core` → `protocol` → `sdk`
  - 操作：`scripts/publish.sh --release`
  - 验收：`npm view @claw-network/sdk version` 返回 `0.2.0`

### R-3. Python SDK 发布到 PyPI

- [ ] **R-3.1** 本地构建 + 测试
  - 操作：`cd packages/sdk-python && hatch build && hatch run test`
  - 验收：wheel 构建成功，测试通过

- [ ] **R-3.2** 确认包名和 import 路径一致
  - PyPI 包名：`clawnet-sdk`
  - import 路径：`from clawnet import ClawNetClient`
  - 验收：`pip install dist/clawnet_sdk-*.whl && python -c "from clawnet import ClawNetClient; print('OK')"`

- [ ] **R-3.3** 发布到 PyPI
  - 操作：`hatch publish`（需要 PyPI API token）
  - 验收：`pip install clawnet-sdk` 成功

### R-4. Testnet 稳定性观察（T-3.9）

- [~] **R-4.1** 7 天观察窗口（2026-02-26 → 2026-03-04）
  - 自动化：cron 每日 CET 07:00 执行 `daily-monitor.sh`
  - Day 1 (02-26): ✅ 通过
  - Day 2 (02-27): ⏳
  - Day 3 (02-28): ⏳
  - Day 4 (03-01): ⏳
  - Day 5 (03-02): ⏳
  - Day 6 (03-03): ⏳
  - Day 7 (03-04): ⏳
  - 验收：连续 5 天无异常（健康检查 + 对账 0 差异 + 场景回归通过）

---

## 🟡 P1 — 强烈建议（用户体验关键）

> 不做也能跑，但外部开发者体验会很差。

### R-5. API Key 分发机制

- [ ] **R-5.1** 设计 API Key 管理方案
  - 当前：单一共享 `CLAW_API_KEY`（Caddy 层校验写操作）
  - 目标：支持多个独立 Key，每 Key 有 label/创建时间/状态
  - 存储：SQLite 或 LevelDB

- [ ] **R-5.2** 实现 Key CRUD 管理命令
  - `clawnet api-key create <label>` → 生成新 Key
  - `clawnet api-key list` → 列出所有 Key
  - `clawnet api-key revoke <key-id>` → 吊销 Key
  - 验收：创建 Key 后可用于 API 请求

- [ ] **R-5.3** 改造 Caddy / Node 层验证逻辑
  - 方案 A（简单）：Node 层中间件查表验证 `X-Api-Key`
  - 方案 B（高级）：Caddy forward_auth → Node 校验端点
  - 验收：不同 Key 对应不同 Agent 身份，吊销后请求被拒

### R-6. 文档站部署

- [ ] **R-6.1** 构建文档站
  - 目录：`packages/docs/`（Next.js + Fumadocs）
  - 操作：`pnpm --filter docs build`
  - 验收：本地 `pnpm --filter docs start` 可访问

- [ ] **R-6.2** 配置公网域名 + Caddy 反向代理
  - 域名建议：`docs.clawnetd.com`
  - 在 Server A 的 Caddyfile 添加反向代理规则
  - 验收：`curl https://docs.clawnetd.com` 返回文档页面

### R-7. 修复示例代码

- [ ] **R-7.1** Node.js 示例改用 npm 发布包
  - 文件：`examples/nodejs-agent/package.json`
  - 将 `"@claw-network/sdk": "workspace:*"` → `"@claw-network/sdk": "^0.2.0"`
  - 验收：新目录 `npm install && npx ts-node agent.ts` 可运行

- [ ] **R-7.2** Python 示例确认 pip install 可用
  - 文件：`examples/python-agent/README.md`
  - 确认 `pip install clawnet-sdk` 后示例可直接运行
  - 验收：`python agent.py` 连接 `api.clawnetd.com` 成功

- [ ] **R-7.3** 补充 .env.example 给示例项目
  - 内容：`CLAW_NODE_URL`, `CLAW_API_KEY`, `CLAW_AGENT_DID`, `CLAW_PASSPHRASE`
  - 验收：开发者 copy .env.example → .env 后即可运行

### R-8. Docker 镜像发布

- [ ] **R-8.1** 修复 Dockerfile P2P 端口
  - 当前 `EXPOSE 9529`，应为 `EXPOSE 9527`
  - 验收：`docker inspect` 显示 9527

- [ ] **R-8.2** 构建并推送到 GHCR
  - 操作：
    ```bash
    docker build -t ghcr.io/claw-network/clawnetd:0.2.0 .
    docker push ghcr.io/claw-network/clawnetd:0.2.0
    docker tag ... :latest && docker push ... :latest
    ```
  - 验收：`docker pull ghcr.io/claw-network/clawnetd:0.2.0` 成功

- [ ] **R-8.3** 验证 Docker 容器可运行
  - 操作：`docker run -e CLAW_PASSPHRASE=test ghcr.io/claw-network/clawnetd:0.2.0`
  - 验收：容器内 `curl localhost:9528/api/v1/node` 返回 JSON

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

# 检查 Token totalSupply
ssh clawnet-geth-a 'curl -s http://127.0.0.1:9528/api/wallet/balance'

# 检查 faucet
curl -sf -X POST https://api.clawnetd.com/api/dev/faucet \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $CLAW_API_KEY" \
  -d '{"did":"did:claw:test123"}'

# 检查 Docker 镜像
docker pull ghcr.io/claw-network/clawnetd:0.2.0
```

---

*最后更新: 2026-02-26*
*关联文档: on-chain-tasks.md (T-3.9 ~ T-3.15), TOKEN_DISTRIBUTION.md, OPENCLAW_INTEGRATION.md*
