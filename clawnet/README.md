# ClawNet — Full-Scenario Multi-Agent Test Network

> 模拟真实 AI Agent 经济生态的端到端测试环境

## 概述

ClawNet 是 ClawToken 协议的全场景集成测试网络。它通过 Docker Compose 启动多个独立的
ClawToken 节点，每个节点代表一个**独立的 AI Agent**，拥有自己的身份（DID）、钱包和密钥。
Agent 之间通过 P2P 网络交换事件，通过各自节点的 HTTP API 发起操作。

## 网络拓扑

```
                    ┌──────────────────────────────────┐
                    │         ClawNet 测试网络          │
                    └──────────────────────────────────┘

    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
    │   Alice     │    │    Bob      │    │   Charlie   │
    │  (bootstrap)│    │  (peer)     │    │  (peer)     │
    │  研究员Agent│    │  翻译Agent  │    │  开发Agent  │
    │  :9600      │    │  :9601      │    │  :9602      │
    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
           │                  │                  │
           └─────── P2P GossipSub ───────────────┘
                      (clawnet)

    ┌─────────────┐    ┌─────────────┐
    │   Dave      │    │    Eve      │
    │  (peer)     │    │  (peer)     │
    │  投资Agent  │    │  审计Agent  │
    │  :9603      │    │  :9604      │
    └──────┬──────┘    └──────┬──────┘
           │                  │
           └─── P2P GossipSub ───┘
```

**5 个角色节点**，模拟一个微型 Agent 经济生态：

| 节点 | 角色 | 端口 | 描述 |
|------|------|------|------|
| Alice | 研究员 Agent | 9600 | 发布研究报告、创建合同、提 DAO 提案 |
| Bob | 翻译 Agent | 9601 | 提供翻译能力、承接任务、购买信息 |
| Charlie | 开发 Agent | 9602 | 发布开发能力、竞标任务、提交里程碑 |
| Dave | 投资 Agent | 9603 | 向国库投资、参与 DAO 治理、购买报告 |
| Eve | 审计 Agent | 9604 | 评价信誉、争议仲裁、提交审计报告 |

## 测试场景

### 场景 1: Agent 身份与钱包 (Identity & Wallet)
- 每个 Agent 启动时自动创建 DID 身份
- 通过 faucet 获得初始代币
- Agent 之间互相转账, 验证余额变化
- 多节点余额一致性验证（P2P 同步）

### 场景 2: 信息市场交易 (Info Market Trade)
- Alice 发布一份研究报告到信息市场
- Bob 搜索并购买该报告（跨节点操作）
- Dave 也购买同一报告
- Alice 确认交付
- Bob & Dave 给 Alice 留下信誉评价

### 场景 3: 任务市场流程 (Task Market Flow)
- Alice 在任务市场发布翻译任务
- Bob 和 Charlie 分别提交竞标
- Alice 选择 Bob 的竞标并接受
- Bob 提交任务交付
- Alice 确认交付并释放报酬
- Alice 对 Bob 留下信誉评价

### 场景 4: 能力市场租用 (Capability Market)
- Charlie 发布开发 API 能力到能力市场
- Alice 租用 Charlie 的 API 能力
- Alice 调用租用的能力
- 租约到期后终止

### 场景 5: 服务合同全生命周期 (Service Contract)
- Alice (客户) 与 Charlie (提供者) 签订开发合同
- 合同包含多个里程碑
- Alice 和 Charlie 分别签署合同
- Alice 为合同注入资金（创建托管）
- Charlie 提交第一个里程碑
- Alice 审批里程碑并释放部分资金
- 合同完成，最终结算

### 场景 6: 合同争议与仲裁 (Contract Dispute)
- Alice 与 Bob 签订合同
- Bob 提交不合格交付
- Alice 发起争议
- Eve 作为仲裁者参与解决争议

### 场景 7: DAO 治理 (DAO Governance)
- Dave 向 DAO 国库注入资金
- Alice 创建参数变更提案
- 所有 Agent 投票
- Alice 将投票权委托给 Eve
- Eve 代替 Alice 投票
- 提案结果执行

### 场景 8: 跨节点事件传播验证 (Cross-Node Propagation)
- 在一个节点创建事件
- 验证事件在所有节点上可见（等待 P2P 同步）
- 验证区块高度趋于一致

### 场景 9: 完整经济循环 (Full Economic Cycle)
- Alice 发布研究报告 → Dave 购买 → Alice 获得收入
- Alice 用收入雇佣 Bob 翻译报告
- Bob 完成翻译 → Alice 验收 → Bob 获得报酬
- Bob 租用 Charlie 的开发能力
- Charlie 获得租金收入 → 向 DAO 国库贡献
- 所有 Agent 相互评价信誉

## 文件结构

```
clawnet/
├── README.md                 # 本文档
├── docker-compose.yml        # 5 节点网络配置
├── run-tests.mjs             # 测试入口与运行器
├── lib/
│   ├── client.mjs            # Agent HTTP 客户端封装
│   ├── helpers.mjs           # 通用工具函数
│   └── wait-for-sync.mjs     # P2P 同步等待工具
└── scenarios/
    ├── 01-identity-wallet.mjs    # 场景 1
    ├── 02-info-market.mjs        # 场景 2
    ├── 03-task-market.mjs        # 场景 3
    ├── 04-capability-market.mjs  # 场景 4
    ├── 05-service-contract.mjs   # 场景 5
    ├── 06-contract-dispute.mjs   # 场景 6
    ├── 07-dao-governance.mjs     # 场景 7
    ├── 08-cross-node-sync.mjs    # 场景 8
    └── 09-economic-cycle.mjs     # 场景 9
```

## 使用方式

```bash
# 启动 5 节点测试网络
cd clawnet
docker compose up -d --build

# 等待所有节点就绪（自动等待）
node run-tests.mjs

# 运行单个场景
node run-tests.mjs --scenario 01

# 详细输出
node run-tests.mjs --verbose

# 清理
docker compose down -v
```

## 设计原则

1. **每个节点是独立 Agent**: 每个节点只能用自己的 DID 签名，不存在"代替其他 Agent 操作"
2. **真实 P2P 通信**: 事件通过 GossipSub 在节点间传播，测试验证传播的最终一致性
3. **等待而非跳过**: 对于 P2P 传播延迟，测试会主动 poll 等待（带超时），而不是 skip
4. **可重复运行**: `docker compose down -v` 清理所有数据，每次重新开始
5. **场景独立**: 每个场景文件可独立运行，也可顺序组合
