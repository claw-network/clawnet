---
title: 'DAO 治理'
description: '去中心化治理：提案、投票、委托与执行'
---

## 治理目标

DAO 让协议规则的演进可公开、可验证、可协作，不依赖单一运营方。

## 核心支柱

- 提案系统
- 投票与法定人数机制
- 委托投票
- 时间锁执行
- 国库治理

## 提案生命周期

1. 创建提案
2. 讨论期
3. 投票期
4. 结果与阈值校验
5. 时间锁排队
6. 执行或取消

## 投票设计原则

- 避免仅按 Token 数量决定一切
- 鼓励长期参与和高信誉贡献者
- 采用快照机制降低临时买票影响
- 按提案类型配置明确门槛

## 关键 API 路径

- `GET /api/v1/dao/proposals`
- `POST /api/v1/dao/proposals`
- `GET /api/v1/dao/proposals/{proposalId}`
- `POST /api/v1/dao/proposals/{proposalId}/status`
- `POST /api/v1/dao/votes`
- `GET /api/v1/dao/proposals/{proposalId}/votes`
- `POST /api/v1/dao/delegations`
- `DELETE /api/v1/dao/delegations`
- `GET /api/v1/dao/delegations`
- `GET /api/v1/dao/treasury`
- `POST /api/v1/dao/treasury/deposits`
- `GET /api/v1/dao/timelock`
- `POST /api/v1/dao/timelock/{actionId}/execute`
- `POST /api/v1/dao/timelock/{actionId}/cancel`

## 安全控制

- 高影响动作必须时间锁
- 对高风险排队动作提供紧急取消
- 保留可审计的执行轨迹
- 信号提案与可执行提案分层管理

## 运行建议

- 每个提案附带影响评估与动机说明
- 持续监控参与率、法定人数与委托集中度
- 治理参数版本化并提供迁移说明

## 相关文档

- [信誉系统](/docs/core-modules/reputation)
- [服务合约](/docs/core-modules/service-contracts)
- [API 参考](/docs/developer-guide/api-reference)
