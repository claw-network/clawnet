# ClawNet 项目约定（Canonical Conventions）

本文档定义项目中**不可变更**的命名、编号、术语约定。  
所有文档、代码、AI 会话、对外沟通**必须**遵守这些约定。

---

## 1. 货币计量单位（Currency Unit）

| 属性 | 值 |
|------|----|
| **名称** | Token |
| **复数** | Tokens |
| **显示符号** | Token / Tokens |
| **最小单位** | 1 Token（整数，无小数） |
| **代码字段** | `currency: 'Token'` |
| **传输格式** | 无符号整数字符串（如 `"500"`） |

### ⚠️ 常见错误

> **货币单位是 Token，不是 CLAW。**
>
> - ✅ 正确：`转账 100 Token`、`余额 500 Tokens`、`手续费 1 Token`
> - ❌ 错误：`转账 100 CLAW`、`余额 500 CLAW`、`手续费 1 CLAW`
>
> "CLAW" 不是货币单位。`CLAW` 仅作为前缀出现在以下场景中：
> - 项目名：ClawNet
> - 合约名：ClawToken.sol, ClawEscrow.sol 等
> - 包名：@claw-network/*
> - 环境变量：CLAW_PASSPHRASE, CLAW_API_KEY, CLAW_DATA_DIR
> - DID 方法：did:claw:
> - 域名：clawnetd.com

---

## 2. 网络端口（Network Ports）

| 端口 | 用途 | 协议 |
|------|------|------|
| **9527** | P2P libp2p 监听端口 | TCP |
| **9528** | HTTP REST API 端口 | TCP |

这两个端口号是项目标识的一部分，不可随意更改。

---

## 3. DID 方法（DID Method）

| 属性 | 值 |
|------|----|
| **方法名** | `claw` |
| **格式** | `did:claw:` + multibase(base58btc(Ed25519 公钥)) |
| **示例** | `did:claw:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK` |

---

## 4. 地址格式（Address Format）

| 属性 | 值 |
|------|----|
| **前缀** | `claw` |
| **格式** | `claw` + base58btc(version + publicKey + checksum) |
| **校验** | SHA-256(publicKey) 前 4 字节 |

---

## 5. P2P 协议（P2P Protocol）

| 属性 | 值 |
|------|----|
| **内容类型** | `application/clawnet-stream` |
| **序列化** | FlatBuffers |
| **引导节点** | `/dns4/clawnetd.com/tcp/9527/p2p/12D3KooWRTEtx4rDkUwx4QsVbaELp8DUiKX8JHa3fRfiagaR9rNW` |

---

## 6. 协议版本

| 属性 | 值 |
|------|----|
| **当前版本** | `v: 1` |
| **版本控制** | 任何破坏性变更需要新版本号 |

---

## 7. SDK 文件与类命名（SDK File & Class Naming）

### 7.1 SDK 仅包含 REST 客户端

SDK 只暴露 REST 客户端类（`*Api`），所有链上合约交互由 Node 服务层在内部完成。SDK **不包含** `ethers.js` 依赖或任何直接的合约调用代码。

| ✅ 正确 | ❌ 错误 |
|---------|---------|
| `wallet.ts`（仅导出 `WalletApi`） | `wallet-onchain.ts`（链上代码不属于 SDK） |
| `identity.ts`（仅导出 `IdentityApi`） | `identity-onchain.ts`（链上代码不属于 SDK） |

### 7.2 类命名——自然命名，禁止标记词

链上逻辑是系统的原生能力，不是外挂组件。命名应自然，不应使用 `OnChain` / `Chain` 等标记词作为前后缀。

| 角色 | 命名模式 | 示例 | 所属包 |
|------|---------|------|--------|
| REST 客户端类 | `*Api` | `WalletApi`, `IdentityApi` | `packages/sdk` |
| Node 服务类 | `*Service` | `WalletService`, `IdentityService` | `packages/node` |
| 配置接口 | `*Config` / `*ServiceConfig` | `WalletConfig`, `DaoServiceConfig` | 各包 |
| 数据接口 | 正常语义命名 | `ServiceContract`, `Milestone`, `Proposal` | 各包 |

### ⚠️ 常见错误

> **禁止在类名、接口名、文件名中使用 `OnChain` 或 `Chain` 作为前缀/后缀。**
> 链上逻辑融入正常文件中，用自然的名字。
>
> - ✅ 正确：`WalletApi`, `WalletService`, `WalletConfig`, `ServiceContract`
> - ❌ 错误：`WalletOnChainApi`, `WalletChainApi`, `WalletChainConfig`, `ChainServiceContract`
> - ❌ 错误：`wallet-onchain.ts`, `wallet.chain.test.ts`

### 7.3 CLI 子命令

所有 CLI 操作通过 REST API 完成，不提供直连链上的子命令。

| ✅ 正确 | ❌ 错误 |
|---------|---------|
| `clawnet wallet balance` | `clawnet onchain wallet balance` |
| `clawnet contract create` | `clawnet chain contract create` |

### 7.4 测试文件

测试文件用正常名称。若已存在同名测试文件，链上相关测试应写入已有文件中，不单独创建。

| ✅ 正确 | ❌ 错误 |
|---------|---------|
| `test/services/wallet-service.test.ts` | `test/wallet-onchain.test.ts`, `test/wallet.chain.test.ts` |
| `wallet.test.ts`（合并入已有文件） | `wallet.chain.test.ts`（单独新建） |
| `p0-integration.test.ts` | `p0-onchain.test.ts` |

---

## 变更控制

以上约定属于 **Spec Freeze** 范围。任何变更需要：
1. 提交 Issue + RFC
2. 版本号变更
3. Changelog 条目
4. 相关负责人签字确认

详见 [SPEC_FREEZE.md](docs/implementation/SPEC_FREEZE.md)
