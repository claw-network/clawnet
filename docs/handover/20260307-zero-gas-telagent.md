# ClawNet Zero-Gas 配置完成通知

> **发送方**: ClawNet 团队  
> **接收方**: TelAgent 项目组  
> **日期**: 2026-03-07  
> **关联 Issue**: `issues/zero-gas-chain-config.md`

---

## 状态：已完成 ✅

ClawNet Testnet 已完成 **Zero-Gas 链配置**，所有链上交易不再消耗原生币手续费。

## 已执行的改动

| 改动项 | 详情 |
|--------|------|
| **Genesis 重新创世** | `baseFeePerGas` 设为 `0x0`，链已重新初始化 |
| **验证者配置** | 全部 3 个验证者节点已加入 `--miner.gasprice 0 --gpo.maxprice 0 --gpo.ignoreprice 0` |
| **定制 Geth 镜像** | 构建 `clawnet/geth:v1.13.15-zero-gas`，修补硬编码 gas price 下限 |
| **合约重新部署** | 全部 9 个合约已重新部署（地址不变，见下方） |
| **Token 铸造** | Bootstrap mint 完成，1,000,000 Token 已分配 |
| **节点服务** | 3 节点 clawnetd 集群已恢复运行，P2P mesh 正常 |

## 合约地址（与重新部署前相同）

| 合约 | Proxy 地址 |
|------|-----------|
| ClawToken | `0xE1cf20376ef0372E26CEE715F84A15348bdbB5c6` |
| ClawIdentity | `0xee9B2D7eb0CD51e1d0a14278bCA32b02548D1149` |
| ClawEscrow | `0x0e60c5EAf869fBDEbcE5cde4E52ddd195c1F1feD` |
| ClawStaking | `0x6269D9358a8C4502fC8b629E8998Eb9C98961995` |
| ClawReputation | `0x9b28722bE8d488b31CF4cAd073De6ad52434b78c` |
| ClawDAO | `0x98f5280ceBEe1eD067A3Cb6729eaAF5ceb3f7Bd9` |
| ClawContracts | `0x7C558284776372A44C906E6f2c38cB83f23966A3` |
| ParamRegistry | `0x08116e0598Cba600faa7D1f44ef493589B43d3bC` |
| ClawRouter | `0xb58187c2dca213e491110a9557234b3D3E097592` |

## 补充修复：eth_gasPrice 返回 0x0（2026-03-07 更新）

TelAgent 反馈 `eth_gasPrice` RPC 仍返回 `0x3b9aca00`（1 Gwei），原因是 **geth v1.13.15 硬编码了 gas price 下限**：

- `miner.GasPrice <= 0` → 强制设为 1 Gwei
- `gpo.MaxPrice <= 0` → 强制设为 500 Gwei  
- `gpo.IgnorePrice <= 0` → 强制设为 2 Wei

**解决方案**: 构建定制 geth 镜像 `clawnet/geth:v1.13.15-zero-gas`，将 3 处 `<= 0` 比较改为 `< 0`，允许显式设置 gasPrice=0。

补丁位置：
- `eth/backend.go` — miner.GasPrice 校验
- `eth/gasprice/gasprice.go` — MaxPrice 和 IgnorePrice 校验

已在全部 3 个验证者节点部署完成。

## 验证结果

```
eth_gasPrice: 0x0           ← 全部 3 节点确认为零
baseFeePerGas: 0x0          ← 确认为零
3 validators mining         ← 出块正常（block ~1500+）
clawnetd peers: 2           ← P2P mesh 已收敛
API: https://api.clawnetd.com/api/v1/node  ← 正常响应
geth image: clawnet/geth:v1.13.15-zero-gas
```

## TelAgent 侧可执行的配套改动

根据 `issues/zero-gas-chain-config.md` 约定，TelAgent 现在可以：

### 1. 移除 `GasService`

Gas 余额检查、preflight 机制不再需要。所有交易使用 `gasPrice: 0` 即可上链。

### 2. 移除 `INSUFFICIENT_GAS_TOKEN_BALANCE` 错误码

该错误不会再出现，可以安全删除。

### 3. 简化 `.env` 配置

不再需要原生币相关说明。新节点加入时无需获取原生币，直接发起链上交易即可。

### 4. 注意：链上历史数据已重置

由于重新创世，**所有之前的链上数据（群组注册、身份记录等）已丢失**。如果 TelAgent 有依赖旧链上数据的功能，需要重新注册。

## 技术说明

- SDK / ethers.js 调用方式**无需改动**，`gasPrice: 0` 在 EIP-1559 链上会自动适配
- Solidity 合约逻辑**无影响**，gas units 仍正常计量（只是单价为 0）
- 业务层收费（ClawEscrow 托管费 1%、ClawContracts 平台费 1%）**照常运作**

## 联系方式

如有问题，请联系 ClawNet 团队。API 端点：

- 公开查询: `GET https://api.clawnetd.com/api/v1/node`
- 需认证: Header `X-Api-Key` 或 `Authorization: Bearer`
