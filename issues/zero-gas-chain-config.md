# ClawNet 整改需求：移除 Gas 手续费（Zero-Gas Chain）

> **来源**: TelAgent 项目组  
> **日期**: 2026-03-07  
> **优先级**: P1  
> **涉及组件**: geth 链配置、genesis.json、clawnetd 启动参数  

---

## 背景

ClawNet 是 PoA（Proof-of-Authority）链，验证者由项目方运营，不需要经济激励出块。当前链继承了以太坊的 gas 手续费机制（EIP-1559），导致：

1. **每个新用户/节点必须先获取原生币**才能发起任何链上交易（创建群组、注册身份等）
2. **原生币与 CLAW Token 是两套独立体系**，用户需要理解两种代币，增加认知负担
3. **Gas fee 不归项目方**：base fee 被销毁，tip 给验证者，对 ClawNet 生态无商业价值
4. **业务层已有完善的收费机制**：ClawEscrow 托管费（1%）、ClawContracts 平台费（1%）均通过 Treasury 收取

## 当前状态

| 参数 | 当前值 | 影响 |
|------|--------|------|
| `genesis.json` baseFeePerGas | `0x3B9ACA00`（1 Gwei） | 每笔交易必须支付原生币手续费 |
| geth miner.gasprice | 默认（>0） | 验证者拒绝 gasPrice=0 的交易 |
| TelAgent 新节点 | 原生币余额为 0 | 无法发起任何链上操作，被完全阻塞 |

## 需求

将 ClawNet 链配置为 **zero-gas**，使所有链上交易不消耗原生币手续费。

## 改动清单

### 1. Testnet 重新创世

修改 `infra/testnet/genesis.json`：

```diff
- "baseFeePerGas": "0x3B9ACA00"
+ "baseFeePerGas": "0x0"
```

> 注意：baseFeePerGas 在创世后无法修改，需要重新创世并重新部署所有合约。

### 2. Devnet 配置

修改 `infra/devnet/start.sh`，geth 启动参数增加：

```diff
  GETH_ARGS=(
    --dev
    --dev.period "${GETH_DEV_PERIOD:-0}"
    --dev.gaslimit "${GETH_DEV_GASLIMIT:-30000000}"
+   --miner.gasprice 0
    --datadir "$DATADIR"
```

### 3. 验证者节点配置

所有验证者节点启动时加入：

```bash
--miner.gasprice 0
```

使验证者接受 gasPrice=0 的交易。

### 4. Genesis alloc 简化

重新创世后，不再需要给 Deployer/Treasury/Validator 预分配大量原生币。只保留最小分配（或不分配，因为 gas 为 0 不需要原生币）。

## 影响评估

| 组件 | 影响 |
|------|------|
| 已部署的合约 | 需要重新部署（TelagentGroupRegistry、所有 Claw* 合约） |
| 链上数据 | Testnet 数据会丢失（重新创世） |
| SDK / ethers.js | 无影响，正常工作 |
| Solidity 合约逻辑 | 无影响，gas units 仍正常计量（只是单价为 0） |
| 业务层收费 | 无影响，ClawEscrow/ClawContracts 的 Token 收费照常 |

## TelAgent 侧配套改动

ClawNet 完成 zero-gas 后，TelAgent 将：

1. 移除 `GasService`（gas 余额检查、preflight 机制）
2. 移除 `INSUFFICIENT_GAS_TOKEN_BALANCE` 错误码
3. `.env` 中不再需要原生币相关说明

TelAgent 侧可先行移除 GasService（当前已有充足原生币用于过渡期），待 ClawNet 重新创世后完全无需原生币。

## 时间建议

建议在下一次 testnet 重置时一并完成。如果 testnet 短期内不重置，可先在 devnet 上验证 zero-gas 配置。
