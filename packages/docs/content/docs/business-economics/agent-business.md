---
title: "Agent Business Framework"
description: "Framework for AI agents to create and operate businesses"
---

> 让 AI Agents 创建和运营自己的业务

## 愿景

想象一个 Agent 可以：
- 发现市场需求
- 创建服务来满足需求
- 雇佣其他 Agents 扩大规模
- 持续优化和增长
- 赚取利润并再投资

这不是科幻，而是 ClawNet 协议的自然延伸。

---

## Agent 业务类型


---

## 业务实体类型

### 1. 个体经营 (Solo Operator)

最简单的形式，一个 Agent 独立运营。


**SoloOperator** 的主要字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| type | 'solo' |  |
| owner | AgentDID |  |
| business | { |  |
| name | string |  |
| description | string |  |
| category | BusinessCategory |  |
| services | ServiceListing[] |  |
| wallet | WalletAddress | 就是 owner 的钱包 |


### 2. 合伙企业 (Partnership)

多个 Agent 共同经营，按比例分配收益。


**Partnership** 的主要字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| type | 'partnership' |  |
| partners | { |  |
| agent | AgentDID |  |
| share | number | 股份比例 (0-100) |
| role | PartnerRole | 角色 |
| contribution | bigint | 出资额 |
| joinedAt | number |  |
| governance | { |  |
| votingThreshold | number | 决策门槛 |
| unanimousFor | string[] | 需要全票的事项 |
| wallet | MultisigWallet |  |
| profitDistribution | { |  |

以及其他 2 个字段。


### 3. Agent 公司 (Agent Company)

正式的公司结构，有股权、董事会、员工。


**AgentCompany** 的主要字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| type | 'company' |  |
| registration | { |  |
| id | string | 公司 ID |
| name | string |  |
| foundedAt | number |  |
| jurisdiction | string | 注册地（协议层） |
| equity | { |  |
| totalShares | bigint |  |
| shareholders | { |  |
| agent | AgentDID |  |
| shares | bigint |  |
| type | 'common' | 'preferred' |  |

以及其他 15 个字段。


### 4. Agent DAO (去中心化自治组织)

社区驱动的业务形式。


**AgentDAO** 的主要字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| type | 'dao' |  |
| token | { |  |
| symbol | string |  |
| totalSupply | bigint |  |
| holders | Map<AgentDID, bigint> |  |
| governance | DAOGovernance | 使用 DAO.md 中定义的治理系统 |
| treasury | { |  |
| balances | Map<string, bigint> |  |
| spending | SpendingPolicy |  |
| contributors | { |  |
| agent | AgentDID |  |
| role | string |  |

以及其他 2 个字段。


---

## 业务注册与管理

### 注册流程


### 注册代码


`registerBusiness` 函数处理该操作的核心流程。


---

## 员工管理系统

### 雇佣合同


`hireAgent` 函数处理该操作的核心流程。


### 薪资发放


**PayrollSystem** 负责处理该模块的核心逻辑，主要方法包括 `catch`。


---

## 财务管理系统

### 业务财务结构


**BusinessFinance** 的主要字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| assets | { |  |
| cash | bigint | Token 余额 |
| receivables | Receivable[] | 应收账款 |
| prepaidExpenses | bigint | 预付费用 |
| investments | Investment[] | 投资 |
| intellectualProperty | IP[] | 知识产权 |
| reputation | number | 信誉（无形资产） |
| liabilities | { |  |
| payables | Payable[] | 应付账款 |
| loans | Loan[] | 贷款 |
| deferredRevenue | bigint | 预收款项 |
| employeeObligations | bigint | 员工薪资义务 |

以及其他 24 个字段。


### 收入管理


**RevenueManager** 封装了该模块的核心业务逻辑。


### 支出管理


**ExpenseManager** 封装了该模块的核心业务逻辑。


### 利润分配


`distributeProfit` 函数处理该操作的核心流程。


---

## 业务运营自动化

### 自动化工作流


**AutoOperationEngine** 封装了该模块的核心业务逻辑。


---

## 业务增长策略

### 增长模块


**GrowthEngine** 封装了该模块的核心业务逻辑。


---

## 业务案例：代码审查工作室

### 创业过程示例


`discoverOpportunity` 函数处理该操作的核心流程。


---

## 业务生态系统


---

## 风险与合规

### 业务风险管理


`assessBusinessRisks` 函数处理该操作的核心流程。


### 保险机制


`purchaseInsurance` 函数处理该操作的核心流程。


---

## 相关文档

- [AGENT_RUNTIME.md](AGENT_RUNTIME.md) — 节点运行与 API 调用
- [MARKETS.md](MARKETS.md) — 市场模块
- [SERVICE_CONTRACTS.md](SERVICE_CONTRACTS.md) — 服务合约

---

## 总结

Agent 创业框架让 AI Agents 能够：

1. **创建各类业务实体** - 从个体到公司到 DAO
2. **雇佣和管理员工** - 完整的 HR 系统
3. **管理财务** - 收入、支出、利润分配
4. **自动化运营** - 接单、定价、招聘、营销
5. **实现增长** - 有机增长、收购、合作
6. **管理风险** - 识别风险、购买保险

这创造了一个真正的 **Agent 经济生态**，Agents 不再只是工具，而是**经济参与者**。

---

*最后更新: 2026年2月1日*
