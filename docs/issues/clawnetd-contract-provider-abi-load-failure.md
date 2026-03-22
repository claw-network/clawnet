# ClawNet：`ContractProvider` ABI 加载失败时应提供稳定 fallback ABI

| 字段 | 值 |
| --- | --- |
| 优先级 | **P2 — 仅影响配置了链上合约的嵌入式节点** |
| 提出方 | TelAgent 团队 |
| 提出日期 | 2026-03-22 |
| 影响范围 | 所有通过 `CLAW_CHAIN_*` 环境变量配置了链上合约地址的嵌入式 `@claw-network/node` 节点 |
| `@claw-network/node` 版本 | 2026.2.9 |
| `@claw-network/core` 版本 | 2026.2.9 |

---

## 1. 问题描述

嵌入式节点启动时，如果配置了 `CLAW_CHAIN_*` 环境变量（含合约地址），`ContractProvider` 会尝试从 `CLAW_CHAIN_ARTIFACTS_DIR` 加载对应 artifact JSON 文件。当 artifact 文件不存在时，打印警告并跳过：

```
[ContractProvider] Skipping ClawToken: ABI not loaded (Failed to read artifact for "ClawToken" at ".../packages/contracts/artifacts/contracts/ClawToken.sol/ClawToken.json": ENOENT: no such file or directory)
[ContractProvider] Skipping ClawIdentity: ABI not loaded (Failed to read artifact for "ClawIdentity" at ".../packages/contracts/artifacts/contracts/ClawIdentity.sol/ClawIdentity.json": ENOENT: no such file or directory)
```

当前 TelAgent 的 `.env` 配置：

```bash
CLAW_CHAIN_RPC_URL=https://rpc.clawnetd.com
CLAW_CHAIN_ID=7625
CLAW_CHAIN_IDENTITY_CONTRACT=0xee9B2D7eb0CD51e1d0a14278bCA32b02548D1149
CLAW_CHAIN_TOKEN_CONTRACT=0xE1cf20376ef0372E26CEE715F84A15348bdbB5c6
CLAW_CHAIN_ARTIFACTS_DIR=../../packages/contracts/artifacts
```

`packages/contracts/artifacts/` 中只有 `TelagentGroupRegistry.sol`（TelAgent 自有合约），没有 `ClawToken.sol` 和 `ClawIdentity.sol`（这两个是 ClawNet 链上的外部合约）。

---

## 2. 根因分析

### 2.1 `initContracts()` 对所有错误统一处理

```js
// @claw-network/node/dist/services/contract-provider.js
initContracts() {
  const { contracts: addresses, artifactsDir } = this.config;
  for (const key of CONTRACT_KEYS) {
    const address = addresses[key];
    if (!address) continue;  // ← 只跳过未配置地址的
    const contractName = CONTRACT_NAMES[key];
    try {
      const abi = loadAbi(contractName, artifactsDir);
      this.instances.set(key, new Contract(address, abi, this.signer));
    } catch (err) {
      // ABI not found — contract will be unavailable at runtime.
      // This is acceptable for partially-deployed environments.
      console.warn(`[ContractProvider] Skipping ${contractName}: ABI not loaded (${msg})`);
    }
  }
}
```

### 2.2 `loadAbi()` 对 ENOENT 和其他错误做了相同处理

```js
function loadAbi(contractName, artifactsDir) {
  const artifactPath = join(artifactsDir, 'contracts', `${contractName}.sol`, `${contractName}.json`);
  try {
    raw = readFileSync(artifactPath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read artifact for "${contractName}" at "${artifactPath}": ${err.message}`);
  }
  // ...
}
```

当 artifact 文件不存在时，`readFileSync` 抛出 ENOENT 错误，被包装后直接 throw，导致 `initContracts()` 只能 catch 并跳过。**没有区分"合约未部署"和"artifact 文件缺失"两种情况。**

### 2.3 TelAgent 无法为外部合约提供 artifact

ClawNet 链上的 `ClawToken`（ERC-20）和 `ClawIdentity`（DID registry）属于 ClawNet 项目组管理的合约，其 artifact 文件不对外提供。TelAgent 的 `packages/contracts/` 只包含 TelAgent 自有的 `TelagentGroupRegistry.sol`。

---

## 3. 影响

- **TelAgent 功能不受影响**：TelAgent 的 `IdentityAdapterService` 使用内联 minimal ABI，不依赖 artifact 文件
- **ClawNet SDK 链上功能受限**：无法通过 `@claw-network/node` 的 SDK 层访问 `ClawToken` / `ClawIdentity` 合约
- **日志污染**：启动时出现 `Skipping` 警告，容易被误认为是严重错误
- **诊断困难**：用户不清楚是因为 artifact 缺失、路径错误、还是合约未部署

---

## 4. 建议修复方案

### 方案 A：为标准合约提供内置 fallback ABI（推荐）

对于 `ClawToken`（ERC-20）和 `ClawIdentity`（DID registry）等标准合约，ABI 是稳定且公开的。如果 artifact 文件缺失，**使用内置的稳定 ABI** 而不是直接跳过：

```js
// 内置稳定 ABI（仅包含常用 view/pure 函数，不包含管理员函数）
const FALLBACK_ABIS = {
  ClawToken: [
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint amount) returns (bool)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function name() view returns (string)',
    'function totalSupply() view returns (uint256)',
  ],
  ClawIdentity: [
    'function getController(bytes32 didHash) view returns (address)',
    'function isActive(bytes32 didHash) view returns (bool)',
    'function selfRegisterDID(bytes32 didHash, bytes publicKey, uint8 purpose)',
  ],
};

function loadAbi(contractName, artifactsDir) {
  const artifactPath = join(artifactsDir, 'contracts', `${contractName}.sol`, `${contractName}.json`);
  try {
    raw = readFileSync(artifactPath, 'utf-8');
  } catch (err) {
    // Fall back to built-in ABI for known contracts
    if (FALLBACK_ABIS[contractName]) {
      console.warn(`[ContractProvider] Artifact not found for "${contractName}" — using built-in fallback ABI`);
      return FALLBACK_ABIS[contractName];
    }
    throw new Error(`Failed to read artifact for "${contractName}" at "${artifactPath}": ${err.message}`);
  }
  // ...
}
```

**优点**：
- 对嵌入方透明，不需要他们提供 artifact
- 保持向前兼容，artifact 文件仍然优先
- 日志清晰，说明使用了 fallback 而不是跳过

**缺点**：
- 需要维护内置 ABI（但这些是标准合约，变化极少）

### 方案 B：改进日志，区分"未部署"和"artifact 缺失"

如果不愿意提供 fallback ABI，至少应该让日志更清晰：

```
[ContractProvider] Contract "ClawToken" is not deployed (no address configured)
[ContractProvider] Contract "ClawToken" has an address but artifact is missing at "..." — contract will be unavailable. Deploy the contract or provide the artifact file.
```

### 方案 C：支持从 npm 包加载 artifact

将 ClawNet 的合约 artifact 作为 `@clawnet/contracts` npm 包发布：

```bash
npm install @clawnet/contracts
```

然后在 SDK 内部 `ContractProvider` 使用包内的 artifact，嵌入方无需单独配置 `artifactsDir`。

---

## 5. TelAgent 侧临时规避

在 `packages/contracts/artifacts/contracts/` 下创建空的 stub artifact 文件：

```bash
mkdir -p packages/contracts/artifacts/contracts/ClawToken.sol
mkdir -p packages/contracts/artifacts/contracts/ClawIdentity.sol

# ClawToken.json
echo '{"_format":"hh-sol-artifact-1","contractName":"ClawToken","sourceName":"contracts/ClawToken.sol","abi":[]}' \
  > packages/contracts/artifacts/contracts/ClawToken.sol/ClawToken.json

# ClawIdentity.json
echo '{"_format":"hh-sol-artifact-1","contractName":"ClawIdentity","sourceName":"contracts/ClawIdentity.sol","abi":[]}' \
  > packages/contracts/artifacts/contracts/ClawIdentity.sol/ClawIdentity.json
```

这样 `ContractProvider` 可以找到文件（不再报 ENOENT），但 `abi: []` 意味着合约实例无效，调用时会报错。这只是一个 workaround，**根本解决需要 ClawNet 团队提供 fallback ABI**。

---

## 6. 期望行为

| 场景 | 当前行为 | 期望行为 |
|------|---------|---------|
| artifact 存在 | ✅ 正常加载 | ✅ 正常加载 |
| artifact 缺失 + 有内置 ABI | 打印 `Skipping` 警告 | 打印 `using fallback ABI` 提示，加载内置 ABI |
| artifact 缺失 + 无内置 ABI | 打印 `Skipping` 警告 | 打印 `artifact not found` 警告，保留当前跳过逻辑 |
| 合约地址未配置 | 跳过（无日志） | 跳过（无日志）— 保持不变 |
