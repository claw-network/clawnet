# 回复：ClawNet ContractProvider ABI 加载失败时应提供稳定 fallback ABI

| 字段 | 值 |
| --- | --- |
| 原始 Issue | `clawnetd-contract-provider-abi-load-failure.md` |
| 优先级 | **P2** |
| 状态 | **已修复** |
| 修复日期 | 2026-03-22 |
| 修复版本 | **2026.2.10** |

---

感谢 TelAgent 项目组详细的问题分析。你们正确指出了两个问题：

1. **artifact 文件不存在时直接跳过** — 嵌入式节点无法访问 ClawNet 官方合约的 artifact
2. **日志不够清晰** — "Skipping" 容易被误认为是严重错误

---

## 1. 修复方案

采用你们建议的 **方案 C**：将 `@claw-network/contracts` 从私有包改为可发布的 npm 包，`ContractProvider` 在本地 artifact 缺失时自动从 npm 包加载。

### 变更内容

**`packages/contracts/package.json`**
- 移除 `"private": true`，包现在可以发布到 npm

**`packages/node/src/services/contract-provider.ts`**
- 新增 `resolveArtifactPath()` — 先尝试本地 `artifactsDir`，找不到则通过 `require.resolve('@claw-network/contracts/...')` 从 npm 包加载
- 移除硬编码的 fallback ABI

**`packages/node/src/services/chain-config.ts`**
- `artifactsDir` 改为 `optional()` — 嵌入方可以不配置此字段

---

## 2. 行为变化

| 场景 | 旧行为（2026.2.9） | 新行为（2026.2.10） |
|------|---------------------|---------------------|
| `artifactsDir` 配置 + artifact 存在 | ✅ 正常加载 | ✅ 正常加载（不变） |
| `artifactsDir` 配置 + artifact 不存在 | ⚠️ Skipping 警告 | ✅ 从 `@claw-network/contracts` npm 包加载 |
| `artifactsDir` 未配置 | ❌ 报错 | ✅ 直接从 `@claw-network/contracts` npm 包加载 |
| npm 包也未安装 | — | ⚠️ 跳过合约并打印警告 |

---

## 3. TelAgent 升级步骤

### 选项 A：无需任何配置（推荐）

升级 `@claw-network/node` 到 `2026.2.10` 后，删除 `CLAW_CHAIN_ARTIFACTS_DIR` 环境变量。`ContractProvider` 会自动从 npm 包加载 `ClawToken` 和 `ClawIdentity` 的 ABI。

```bash
# .env — 移除这一行
# CLAW_CHAIN_ARTIFACTS_DIR=../../packages/contracts/artifacts
```

### 选项 B：保留本地 artifacts

如果 TelAgent 未来需要使用 `ClawToken`/`ClawIdentity` 的完整 ABI（包括管理员函数），可以在本地保留 artifact 文件。本地 artifacts 优先级高于 npm 包。

---

## 4. 长期可维护性

`@claw-network/contracts` npm 包只包含编译后的 `artifacts/` 目录（不含源码、测试、脚本），每次合约升级时随版本发布：

- `contracts/`, `interfaces/`, `libraries/` — 源码，**不发布**
- `scripts/`, `test/` — 开发文件，**不发布**
- `artifacts/build-info/` — 巨大的调试数据，**不发布**
- `artifacts/contracts/*.json` — 完整 ABI，**发布**

这样嵌入式节点总能获取到与 ClawNet 链上部署版本匹配的官方 ABI。
