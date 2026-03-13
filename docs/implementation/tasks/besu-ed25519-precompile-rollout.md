# Besu 0x0100 Ed25519 预编译实施计划

> **状态**: Ready  
> **创建日期**: 2026-03-13  
> **目标**: 在当前 Besu QBFT 链运行时中落地 `0x0100` Ed25519 预编译，先完成链节点 backend 与仓库内集成验证，再决定是否把 `ClawIdentity` 主路径切回 DID 原生 Ed25519 校验。

---

## 目录

1. [背景与决策更新](#1-背景与决策更新)
2. [当前状态](#2-当前状态)
3. [目标与范围](#3-目标与范围)
4. [接口契约](#4-接口契约)
5. [实施阶段](#5-实施阶段)
6. [仓库内具体改动清单](#6-仓库内具体改动清单)
7. [测试策略](#7-测试策略)
8. [发布与回滚](#8-发布与回滚)
9. [验收标准](#9-验收标准)
10. [风险与缓解](#10-风险与缓解)
11. [不在范围内](#11-不在范围内)

---

## 1. 背景与决策更新

此前关于 Ed25519 Phase 2 的讨论曾默认“Reth 自定义预编译”。这个前提已经过时。

ClawNet 当前链运行时已经迁移到 **Hyperledger Besu + QBFT**。仓库中的 devnet、testnet、mainnet 相关入口都以 Besu 为准：

- `infra/devnet/start.sh` 直接启动本地 `besu` 进程
- `infra/testnet/docker-compose.yml` 默认固定到 `hyperledger/besu:24.12.2`
- `infra/mainnet/docker-compose.yml` 默认固定到 `hyperledger/besu:24.12.2`
- testnet/mainnet deploy 脚本支持通过 `CLAWNET_BESU_IMAGE` 覆盖为自定义 Besu 镜像

因此，后续链上 Ed25519 验证的正确落地方向不是 Reth，而是：

1. 在 Besu 中实现 `0x0100` Ed25519 预编译 backend
2. 保持 Solidity 侧 `Ed25519Verifier` 适配层地址与输入输出格式稳定
3. 先完成链节点能力和仓库内集成验证
4. 再决定是否把 `ClawIdentity` 的注册/轮换主路径切回 DID 原生 Ed25519 校验

这个顺序是刻意的。当前 `ClawIdentity` 主路径已经使用 controller ECDSA proof-of-possession，并不依赖 `Ed25519Verifier` 才能保持安全。因此可以把风险拆成两步，而不是一次性动链客户端和业务主路径。

---

## 2. 当前状态

### 2.1 合约侧

- `packages/contracts/contracts/libraries/Ed25519Verifier.sol`
  - 已固定预编译地址 `0x0100`
  - `verify()` 当前走 `staticcall(0x0100, input)`
  - backend 缺失时会 fail-closed，显式 revert `Ed25519VerificationUnavailable()`
- `packages/contracts/contracts/ClawIdentity.sol`
  - `registerDID()` 当前验证 controller 的 ECDSA 签名
  - `rotateKey()` 当前验证 controller 的 ECDSA 签名
  - 主路径未调用 `Ed25519Verifier.verify()`

### 2.2 链运行时

- devnet: 本机 `besu` 二进制，由 `infra/devnet/start.sh` 启动
- testnet/mainnet: Docker Compose 启动 Besu 容器
- 仓库已将 testnet/mainnet Compose 切到固定默认标签 `hyperledger/besu:24.12.2`，并支持通过 `CLAWNET_BESU_IMAGE` 覆盖为自定义镜像

### 2.3 结论

当前最稳妥的实施路径是：

- **Phase A**: 先把 Besu 预编译实现出来，并在仓库内完成集成测试
- **Phase B**: 再评估是否把 `ClawIdentity` 主路径切回 Ed25519 原生签名验证

---

## 3. 目标与范围

### 3.1 本计划的目标

- G1: 在 Besu 中提供 `0x0100` Ed25519 验证能力
- G2: 保持 Solidity 侧 `Ed25519Verifier` 接口不变
- G3: 让仓库具备“能本地验证、能 testnet 灰度、能回滚”的完整执行路径
- G4: 不破坏当前 `ClawIdentity` 的安全与可用性

### 3.2 本计划分两段交付

#### 阶段 1：基础设施交付

交付标准：

- 自定义 Besu 镜像可运行
- `0x0100` 可对 `(message, signature, pubkey)` 返回稳定结果
- 仓库内新增 Besu 集成测试并通过
- testnet 可灰度切换自定义镜像

#### 阶段 2：业务路径切换评估

交付标准：

- 明确是否要把 `ClawIdentity` 的注册/轮换改回 DID 原生 Ed25519 证明
- 如果切换，必须带 feature flag、迁移策略和完整回滚路径

### 3.3 不直接做的事

- 不在第一阶段改 `ClawIdentity` 外部接口
- 不在第一阶段引入纯 Solidity Ed25519 verifier
- 不在第一阶段改 DID -> EVM 地址派生逻辑

---

## 4. 接口契约

### 4.1 预编译地址

- 地址固定为 `0x0100`
- Solidity 侧不改地址，不引入第二个临时地址

### 4.2 输入格式

`Ed25519Verifier.verify()` 当前已经固定输入拼接方式：

- `message`: 32 bytes
- `signature`: 64 bytes
- `publicKey`: 32 bytes
- 总输入长度: 128 bytes

即：

```text
input = message[32] || signature[64] || publicKey[32]
```

### 4.3 输出格式

Besu backend 必须返回至少 32 bytes，且与当前 Solidity 适配层保持一致：

- `output[31] == 1` 表示验签成功
- 其他值视为失败

建议直接返回标准 32-byte bool：

- `0x00...00` -> false
- `0x00...01` -> true

### 4.4 失败语义

为了兼容当前 Solidity 适配层：

- backend 正常执行但验签失败: 返回 `false`
- backend 不存在、未注册、执行异常、输出长度异常: 让 Solidity 侧继续 revert `Ed25519VerificationUnavailable()`

### 4.5 加密实现约束

- 必须使用成熟 Ed25519 实现，不要自己写曲线算术
- backend 输出必须完全确定性
- 同一输入在所有验证者节点上必须得到同一结果

---

## 5. 实施阶段

### 5.1 Phase 0：冻结基线

目标：先把要改的运行时版本固定住，避免在 `latest` 漂移上开发。

执行项：

1. 确认当前线上/测试环境实际运行的 Besu 版本。
2. 在外部 Besu fork 中基于该版本创建工作分支。
3. 在仓库内记录此次预编译工作所依赖的 Besu 版本与镜像标签。

必须完成的仓库内改动：

- 新增 `infra/besu/README.md`
  - 记录 Besu fork 仓库地址
  - 记录基线版本/tag
  - 记录镜像命名规则
- 将 testnet/mainnet 的链镜像从 `hyperledger/besu:latest` 改为固定标签
- deploy 脚本支持通过 `CLAWNET_BESU_IMAGE` 注入自定义镜像

建议镜像命名：

- 本地验证: `clawnet/besu-ed25519:dev`
- CI/测试网: `ghcr.io/claw-network/besu-ed25519:<git-sha>`

如果暂时没有镜像仓库，至少也要做到：

- `hyperledger/besu:latest` 不再出现在链部署主入口中

### 5.2 Phase 1：Besu 预编译 PoC

目标：让定制 Besu 对 `0x0100` 给出可验证、可测试的响应。

链客户端实现输入规范：见 `infra/besu/ed25519-precompile-spec.md`。

链客户端分工清单：见 `infra/besu/ed25519-precompile-task-list.md`。

外部 Besu fork 任务：

1. 在 Besu EVM 预编译注册流程中挂载 `0x0100`
2. 实现输入解包：`32 + 64 + 32 = 128 bytes`
3. 调用成熟 Ed25519 库做验签
4. 返回 32-byte bool
5. 添加单元测试，覆盖：
   - 正确签名
   - 错误签名
   - 错误公钥
   - 输入长度不等于 128 bytes
   - 空输入

这一阶段不改 ClawNet 业务合约逻辑，只验证 backend 合约接口契约成立。

### 5.3 Phase 2：仓库内集成验证

目标：让 ClawNet 仓库在本地和 CI 中都能验证 `Ed25519Verifier` 已接上真实 backend。

仓库内任务：

1. 新增一个使用自定义 Besu 镜像的 dev/test 入口
2. 新增 Hardhat 或脚本级集成测试，部署 harness 后直接调用 `verify()`
3. 保留现有单元测试中的 fail-closed 语义测试
4. 新增“backend 存在时返回 true/false”的正反用例

建议新增文件：

- `infra/devnet/docker-compose.ed25519.yml`
- `scripts/test-ed25519-precompile.mjs`
- `packages/contracts/test/Ed25519Verifier.besu.test.ts`

当前仓库状态：以上 3 个入口已经落地，可作为 Phase 2 的最小执行骨架；后续只需把 `CLAWNET_BESU_IMAGE` 指向真实带预编译的 Besu 镜像。

仓库侧验收命令与固定测试向量：见 `infra/besu/ed25519-precompile-spec.md`。

约束：

- 默认 `pnpm --filter @claw-network/contracts test` 仍可在普通 Hardhat 本地网络上运行
- Besu 集成测试单独通过环境变量启用，例如：
  - `CLAWNET_BESU_RPC_URL`
  - `CLAWNET_BESU_PRECOMPILE_TEST=1`

### 5.4 Phase 3：testnet 灰度

目标：在不改变业务主路径的前提下，把自定义 Besu 先上线 testnet。

现场执行清单：见 `infra/besu/testnet-rollout-checklist.md`。

顺序：

1. 先在单机 dev/test 环境验证
2. 再切 testnet Server A
3. 再切 testnet 其他 validator/peer
4. 观察至少 24 小时

仓库内任务：

1. 更新 `infra/testnet/docker-compose.yml`
2. 更新 `infra/testnet/docker-compose.peer.yml`
3. 更新 `infra/testnet/docker-compose.sync.yml`
4. 更新 `infra/testnet/prod/deploy.sh`，让它分发自定义镜像标签，而不是 `latest`
5. 更新运维文档，补充镜像回滚命令

观察项：

- 节点是否正常出块
- RPC 是否正常
- 节点之间是否出现共识分叉
- 预编译调用结果是否稳定一致

### 5.5 Phase 4：是否接入 `ClawIdentity` 主路径

这是第二阶段决策，不与 Phase 1-3 绑死。

推荐分两步做：

1. 先引入 feature flag
2. 再在 flag 关闭默认值下发布

建议方案：

- 不替换现有 `registerDID()` / `rotateKey()` 的行为
- 新增可切换路径，或增加受治理控制的开关
- 开关来源优先考虑 `ParamRegistry` 或合约内显式布尔参数

只有在以下条件满足后，才允许开启主路径 Ed25519：

- testnet 已稳定运行至少一个发布周期
- 集成测试覆盖注册与轮换正反用例
- 节点升级和回滚流程已经演练

---

## 6. 仓库内具体改动清单

### 6.1 第一期必须改

#### 文档与运维

- `docs/implementation/tasks/besu-ed25519-precompile-rollout.md` 作为主计划
- `infra/besu/README.md` 记录外部 fork、镜像版本、构建产物
- `docs/handover/` 新增一次 testnet 灰度记录

#### Infra

- `infra/testnet/docker-compose.yml`
- `infra/testnet/docker-compose.peer.yml`
- `infra/testnet/docker-compose.sync.yml`
- `infra/mainnet/docker-compose.yml`
- `infra/mainnet/docker-compose.peer.yml`
- `infra/mainnet/docker-compose.sync.yml`

要求：

- 全部改成固定自定义 Besu 镜像标签
- 不再依赖 `hyperledger/besu:latest`

#### Devnet / 脚本

- 新增 docker 化本地验证入口
- 不强制替换现有 `infra/devnet/start.sh`
- 允许继续保留本机 `besu` 启动方式作为普通开发模式

#### Contracts 测试

- 保留 `packages/contracts/test/Ed25519Verifier.test.ts` 现有 fail-closed 用例
- 新增仅在自定义 Besu 上运行的集成测试文件

### 6.2 第二期再改

- `packages/contracts/contracts/ClawIdentity.sol`
- 相关测试：注册/轮换路径
- 可能新增治理开关或参数注册逻辑

---

## 7. 测试策略

### 7.1 合约单元测试

保留当前行为：

- backend 不存在 -> revert `Ed25519VerificationUnavailable()`
- 错误签名长度 -> revert `InvalidSignatureLength()`
- payload builder 保持确定性和 domain separation

### 7.2 Besu 集成测试

至少覆盖：

1. 有效签名 -> `verify()` 返回 `true`
2. 无效签名 -> `verify()` 返回 `false`
3. 错误公钥 -> `verify()` 返回 `false`
4. backend 关闭或地址未注册 -> revert `Ed25519VerificationUnavailable()`

### 7.3 节点级测试

至少覆盖：

1. 单节点 devnet 调用稳定
2. 多节点 testnet 不分叉
3. 所有 validator 对同一输入返回完全一致结果

### 7.4 回归测试

必须确认以下内容不受影响：

- `ClawIdentity` 当前 ECDSA 注册/轮换流程
- 钱包、合约、DAO 等其他合约逻辑
- Node API 与 indexer 正常工作

---

## 8. 发布与回滚

### 8.1 发布顺序

1. 本地 patched Besu + harness 集成测试
2. devnet 单节点验证
3. testnet Server A
4. testnet 其他节点
5. mainnet

### 8.2 testnet 发布前检查

- 自定义 Besu 镜像 digest 已固定
- 所有 validator 镜像一致
- 预编译集成测试已通过
- 已准备上一版本镜像标签

### 8.3 回滚原则

如果出现以下任一情况，立即回滚：

- 节点无法同步
- 出块停止
- 不同节点对同一输入返回不同结果
- 自定义 Besu 进程异常退出

回滚动作：

1. 将 `docker-compose.chain.yml` 切回上一稳定镜像
2. `docker compose -f docker-compose.chain.yml up -d`
3. 检查 `eth_blockNumber` 持续增长
4. 检查 peer 数量和共识状态恢复正常

注意：

- 如果第一阶段尚未改 `ClawIdentity` 主路径，则回滚不会影响业务 API 语义
- 这是先做基础设施、后做业务切换的主要收益

---

## 9. 验收标准

满足以下全部条件，第一阶段视为完成：

1. `0x0100` 在自定义 Besu 上可稳定返回 32-byte bool
2. 仓库内存在可重复执行的集成测试
3. testnet 已完成灰度并稳定运行
4. 所有链部署入口都改为固定 Besu 镜像标签
5. 当前 `ClawIdentity` 行为未被意外改变

满足以下全部条件，第二阶段才允许推进：

1. 是否切换 `ClawIdentity` 主路径已有书面决策
2. feature flag 与回滚方案已经实现
3. 注册/轮换路径新增测试全部通过

---

## 10. 风险与缓解

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| `latest` 漂移 | 若继续依赖 `latest` 会导致运行时不可复现 | 已切到固定默认标签，并保留自定义镜像覆盖能力 |
| 共识不一致 | 不同节点对预编译结果不一致会直接分叉 | 只使用确定性实现，先做多节点测试 |
| 一次性改太多 | 同时改链客户端和 `ClawIdentity` 主路径，问题难定位 | 分阶段交付，先基础设施后业务 |
| 测试覆盖不足 | 只有单元测试，没有真实 Besu 集成验证 | 新增自定义 Besu 集成测试 |
| 运维回滚不清晰 | validator 全量升级失败会影响链可用性 | 固定镜像 tag + 明确回滚步骤 |

---

## 11. 不在范围内

- 纯 Solidity Ed25519 verifier 集成
- 修改 DID 地址派生公式
- SDK/CLI 外部接口改名
- 用 Ed25519 替代所有 controller ECDSA 流程
- 在 Phase 1 中要求所有业务合约立刻消费 `0x0100`

---

## 立即执行顺序

如果要今天开始动手，按下面顺序执行：

1. 先冻结 Besu 基线版本，并以 `CLAWNET_BESU_IMAGE` 为唯一自定义镜像注入入口
2. 在外部 Besu fork 中实现并验证 `0x0100`
3. 在本仓库新增自定义 Besu dev/test 入口与集成测试
4. 先灰度到 testnet，不动 `ClawIdentity` 主路径
5. testnet 稳定后，再提交第二阶段是否切换业务路径的设计文档
