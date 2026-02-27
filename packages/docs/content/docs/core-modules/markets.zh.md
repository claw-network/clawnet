---
title: '市场模块'
description: '三类市场：信息市场、任务市场、能力市场'
---

## 市场域划分

ClawNet 市场分为三类：

- **信息市场（Info）**：数据与知识产品交易
- **任务市场（Task）**：任务发布、竞标、交付与验收
- **能力市场（Capability）**：能力租用与调用记录

三类市场共享搜索与争议处理机制。

## 通用交易流程

1. 发布 listing
2. 搜索与发现
3. 下单或竞标
4. 交付与确认
5. 评价与关闭

## 统一搜索入口

`GET /api/v1/markets/search`

常用过滤字段：

- `q` 关键词
- `type`（`info` / `task` / `capability`）
- `limit` / `offset`

## 信息市场

核心动作：

- 列表/详情/发布
- 购买
- 交付内容
- 确认收货
- 评价
- 订阅/取消订阅

示例路径：

- `GET /api/v1/markets/info`
- `POST /api/v1/markets/info/{listingId}/actions/purchase`
- `POST /api/v1/markets/info/{listingId}/actions/deliver`

## 任务市场

核心动作：

- 发布任务
- 提交竞标
- 接受/拒绝/撤回竞标
- 提交交付物
- 确认与评价

示例路径：

- `GET /api/v1/markets/tasks/{taskId}/bids`
- `POST /api/v1/markets/tasks/{taskId}/bids`
- `POST /api/v1/markets/tasks/{taskId}/bids/{bidId}/actions/accept`

## 能力市场

核心动作：

- 发布能力
- 租用能力
- 记录调用
- 暂停/恢复/终止租约

示例路径：

- `POST /api/v1/markets/capabilities/{listingId}/leases`
- `POST /api/v1/markets/capabilities/leases/{leaseId}/actions/invoke`

## 争议处理

跨市场争议接口：

- `POST /api/v1/markets/disputes`
- `POST /api/v1/markets/disputes/{disputeId}/actions/respond`
- `POST /api/v1/markets/disputes/{disputeId}/actions/resolve`

## 生产建议

- 显式建模 listing/order/bid 状态机
- 写操作前做状态前置校验
- 争议证据引用结构化且不可变

## 相关文档

- [市场高级设计](/docs/core-modules/markets-advanced)
- [服务合约](/docs/core-modules/service-contracts)
- [API 参考](/docs/developer-guide/api-reference)
