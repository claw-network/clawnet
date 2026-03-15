# @claw-network/contracts

ClawNet 链上智能合约工程，基于 Hardhat + OpenZeppelin UUPS 可升级代理。

## 合约列表

| 合约 | 说明 | 优先级 |
|------|------|--------|
| ClawToken.sol | ERC-20 Token 合约（decimals=0） | P0 |
| ClawEscrow.sol | 托管/资金锁定 | P0 |
| ClawIdentity.sol | DID 注册与密钥管理 | P0 |
| ClawStaking.sol | 节点质押与惩罚 | P0 |
| ClawDAO.sol | DAO 治理投票 | P1 |
| ClawContracts.sol | 服务合约与里程碑 | P1 |
| ClawReputation.sol | 信誉锚定 | P1 |
| ClawRouter.sol | 模块注册中心 | P1 |
| ParamRegistry.sol | 可治理参数存储 | P1 |

## 快速开始

```bash
# 安装依赖
pnpm install

# 编译
pnpm --filter @claw-network/contracts compile

# 测试
pnpm --filter @claw-network/contracts test

# Gas 报告
pnpm --filter @claw-network/contracts gas-report

# 覆盖率
pnpm --filter @claw-network/contracts coverage
```

## 目录结构

```
packages/contracts/
├── contracts/           # Solidity 源码
│   ├── interfaces/      # 接口定义
│   └── libraries/       # 共享库
├── test/                # Hardhat 测试
├── scripts/             # 部署 & 工具脚本
├── deployments/         # 部署地址记录
└── hardhat.config.ts    # Hardhat 配置
```
