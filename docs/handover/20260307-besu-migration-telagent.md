# ClawNet 共识引擎迁移通知：Geth Clique → Hyperledger Besu QBFT

> **发送方**: ClawNet 团队  
> **接收方**: TelAgent 项目组  
> **日期**: 2026-03-07  
> **前置文档**: `docs/handover/20260307-zero-gas-telagent.md`（Zero-Gas 配置通知）

---

## 状态：已完成 ✅

ClawNet Testnet 已完成**共识引擎迁移**，从 Geth Clique PoA 切换至 Hyperledger Besu QBFT。

## 迁移原因

| 问题 | 说明 |
|------|------|
| **Geth 硬编码 gas price 下限** | 上一轮 Zero-Gas 配置中发现 Geth v1.13.15 硬编码了 gas price 最低值，需要构建定制镜像修补，维护成本高 |
| **Besu 原生支持 zero-gas** | Besu 通过 `zeroBaseFee: true` + `--min-gas-price=0` 即可实现，无需修补源码 |
| **QBFT 拜占庭容错** | QBFT 提供真正的 BFT 容错（3f+1），优于 Clique 的 crash fault tolerance |

## 已执行的改动

| 改动项 | 详情 |
|--------|------|
| **共识引擎** | Clique PoA → QBFT BFT（`blockperiodseconds: 2`） |
| **客户端** | `clawnet/geth:v1.13.15-zero-gas`（定制镜像）→ `hyperledger/besu:latest`（v26.2.0，官方镜像） |
| **Genesis 重新创世** | 全新 QBFT genesis，`zeroBaseFee: true`，London EVM |
| **合约重新部署** | 全部 9 个合约已重新部署（地址不变，确定性部署） |
| **Token 铸造** | Bootstrap mint 完成，1,000,000 Token 已分配 |
| **节点服务** | 3 节点 clawnetd 集群已恢复运行，P2P mesh 正常 |

## 对 TelAgent 的影响

### ✅ 无需修改的部分

| 项目 | 说明 |
|------|------|
| **REST API** | 所有端点、请求/响应格式完全不变 |
| **端口** | API 9528、P2P 9527 不变 |
| **API 域名** | `https://api.clawnetd.com` 不变 |
| **chainId** | 7625 不变 |
| **合约地址** | 全部 9 个合约 proxy 地址不变（见下方） |
| **DID 格式** | `did:claw:*` 不变 |
| **SDK / ethers.js** | 调用方式不变，Besu 完全兼容标准 EVM JSON-RPC |
| **Zero-Gas** | `gasPrice: 0` 仍然有效，且现在由 Besu 原生支持，更可靠 |
| **合约部署** | 标准 EVM 部署流程不变，`eth_sendRawTransaction` 等 RPC 完全兼容 |

### ⚠️ 需要注意的部分

| 项目 | 说明 |
|------|------|
| **链上数据已重置** | 全新创世，**所有之前的链上状态已清空**：DID 注册、Token 余额、合约状态、escrow 记录等。需要重新注册身份和重新充值 |
| **区块高度已重置** | 区块从 0 开始重新计数。如果 TelAgent 有缓存或持久化旧区块高度，需要清除 |
| **出块间隔微调** | Clique 约 2s → QBFT 固定 2s，基本无差异 |

## 合约地址（与迁移前相同）

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

## 验证结果

```
eth_gasPrice: 0x0             ← 全部 3 节点确认为零（Besu 原生支持）
baseFeePerGas: 0x0            ← 确认为零
QBFT validators: 3            ← 3 个验证者节点正常出块
net_peerCount: 2              ← 每节点 2 peers，全连通
clawnetd peers: 2             ← P2P mesh 已收敛
API: https://api.clawnetd.com/api/v1/node  ← 正常响应
client: besu/v26.2.0/linux-x86_64/openjdk-java-25
```

## 技术细节（仅供参考）

- **共识**: QBFT（Quorum Byzantine Fault Tolerance），3 验证者可容忍 0 个拜占庭故障（需 4 节点才能容忍 1 个）
- **EVM**: London 里程碑，EIP-1559 兼容，`baseFeePerGas` 恒为 0
- **RPC API**: `ETH,NET,WEB3,TXPOOL,QBFT,ADMIN`（新增 `QBFT`，移除 `CLIQUE`）
- **Docker 镜像**: `hyperledger/besu:latest`（官方镜像，无定制补丁）

## 联系方式

如有问题，请联系 ClawNet 团队。API 端点：

- 公开查询: `GET https://api.clawnetd.com/api/v1/node`
- 需认证: Header `X-Api-Key` 或 `Authorization: Bearer`
