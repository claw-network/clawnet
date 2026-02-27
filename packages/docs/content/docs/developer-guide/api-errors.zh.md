---
title: 'API 错误码'
description: '按接入期、交易期、生产期分层的排障指南'
---

本页按故障阶段组织，而非仅按错误码罗列。

快速跳转：

- [接入期](#integration-phase)
- [交易期](#transaction-phase)
- [生产期](#production-phase)
- [Identity 错误](#identity-errors)
- [Wallet 错误](#wallet-errors)
- [Markets 错误](#markets-errors)
- [Contracts 错误](#contracts-errors)
- [Reputation 错误](#reputation-errors)

## 错误响应格式

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

常见状态码：

- `400` 参数错误
- `401` 未认证
- `403` 权限不足
- `404` 资源不存在
- `409` 状态冲突
- `429` 限流
- `500` 服务异常

---

<a id="integration-phase"></a>

## 1) 接入期

目标：先跑通读链路和鉴权。

| 场景       | 典型状态/错误         | 根因                               | 处理                      |
| ---------- | --------------------- | ---------------------------------- | ------------------------- |
| 节点不可达 | 超时/网络错误         | baseUrl 错误、节点未启动、反代异常 | 先验证 `GET /api/v1/node` |
| 认证失败   | `401 UNAUTHORIZED`    | API Key 缺失或错误                 | 校验认证头                |
| 权限不足   | `403 FORBIDDEN`       | key 权限范围不匹配                 | 校验 key 策略             |
| 路径错误   | `404 NOT_FOUND`       | 路径或版本不对                     | 确认 `/api/v1/...`        |
| 输入错误   | `400 INVALID_REQUEST` | 字段缺失或类型错误                 | 请求前做 schema 校验      |

回到 API 参考：

- [Node API](/docs/developer-guide/api-reference#api-node)
- [Identity API](/docs/developer-guide/api-reference#api-identity)

---

<a id="transaction-phase"></a>

## 2) 交易期

目标：解决写请求失败和状态冲突。

### 2.1 Wallet / Escrow

<a id="wallet-errors"></a>

| 错误码                 | 含义       | 常见原因           | 处理                      |
| ---------------------- | ---------- | ------------------ | ------------------------- |
| `INSUFFICIENT_BALANCE` | 余额不足   | 可用余额不足       | 先查余额再下单            |
| `TRANSFER_NOT_ALLOWED` | 不允许转账 | 账户/策略限制      | 校验账户状态和策略        |
| `ESCROW_NOT_FOUND`     | 托管不存在 | id 错误或环境混用  | 核对 id 与环境            |
| `ESCROW_INVALID_STATE` | 状态冲突   | 在错误阶段执行动作 | 动作前先读状态            |
| `ESCROW_RULE_NOT_MET`  | 规则未满足 | 证据/参数不完整    | 补齐 rule/evidence/reason |

回到 API 参考：

- [Wallet API](/docs/developer-guide/api-reference#api-wallet)

### 2.2 Markets

<a id="markets-errors"></a>

| 错误码                   | 含义             | 常见原因         | 处理                    |
| ------------------------ | ---------------- | ---------------- | ----------------------- |
| `LISTING_NOT_FOUND`      | listing 不存在   | id 错误          | 先 list/search/get 校验 |
| `LISTING_NOT_ACTIVE`     | listing 不可操作 | 已暂停/过期/下架 | 先查状态                |
| `ORDER_NOT_FOUND`        | order 不存在     | id 错误          | 校验订单链路            |
| `ORDER_INVALID_STATE`    | 订单状态冲突     | 调用顺序错误     | 按状态机顺序调用        |
| `BID_NOT_ALLOWED`        | 不允许竞标       | 策略或窗口限制   | 校验竞标条件            |
| `SUBMISSION_NOT_ALLOWED` | 不允许提交       | 未中标或阶段错误 | 校验归属和状态          |

回到 API 参考：

- [Markets API](/docs/developer-guide/api-reference#api-markets)

### 2.3 Contracts

<a id="contracts-errors"></a>

| 错误码                       | 含义       | 常见原因                | 处理                        |
| ---------------------------- | ---------- | ----------------------- | --------------------------- |
| `CONTRACT_NOT_FOUND`         | 合约不存在 | id 错误                 | 先查详情                    |
| `CONTRACT_INVALID_STATE`     | 状态冲突   | 生命周期顺序错误        | 强制 create->sign->activate |
| `CONTRACT_NOT_SIGNED`        | 未签署     | 签名未齐全              | 补齐签名再执行              |
| `CONTRACT_MILESTONE_INVALID` | 里程碑无效 | milestone id/payload 错 | 先查 milestone 定义         |
| `DISPUTE_NOT_ALLOWED`        | 不允许争议 | 前置条件不满足          | 校验争议条件                |

回到 API 参考：

- [Contracts API](/docs/developer-guide/api-reference#api-contracts)

工程规则：

1. 按 DID 严格递增 nonce
2. 每次写操作前先读状态
3. 仅在安全场景重试写请求

---

<a id="production-phase"></a>

## 3) 生产期

目标：在流量峰值和网络抖动下保持稳定。

| 状态/错误            | 现象         | 常见原因         | 缓解策略                    |
| -------------------- | ------------ | ---------------- | --------------------------- |
| `429 RATE_LIMITED`   | 峰值失败增多 | 客户端突发超阈值 | 全局限流 + 退避抖动         |
| `500 INTERNAL_ERROR` | 间歇失败     | 上游或依赖不稳定 | 有界重试 + 熔断 + 降级      |
| 超时                 | 延迟飙升     | 网络/代理拥塞    | 按端点分层 timeout          |
| 高频 `409`           | 写冲突       | nonce 或状态竞争 | 串行写路径或集中 nonce 分配 |

回到 API 参考：

- [Node API](/docs/developer-guide/api-reference#api-node)
- [Wallet API](/docs/developer-guide/api-reference#api-wallet)
- [Markets API](/docs/developer-guide/api-reference#api-markets)
- [Contracts API](/docs/developer-guide/api-reference#api-contracts)
- [DAO API](/docs/developer-guide/api-reference#api-dao)

生产最低要求：

- 结构化错误日志（`method/path/status/error.code`）
- 请求追踪（`request_id`、latency）
- 5xx/429/401/403 告警

---

## 4) 错误码速查

### 通用

- `INVALID_REQUEST`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

### Identity

<a id="identity-errors"></a>

- `DID_NOT_FOUND`
- `DID_INVALID`
- `DID_UPDATE_CONFLICT`
- `CAPABILITY_INVALID`

回到 API 参考：

- [Identity API](/docs/developer-guide/api-reference#api-identity)

### Wallet

- `INSUFFICIENT_BALANCE`
- `TRANSFER_NOT_ALLOWED`
- `ESCROW_NOT_FOUND`
- `ESCROW_INVALID_STATE`
- `ESCROW_RULE_NOT_MET`

回到 API 参考：

- [Wallet API](/docs/developer-guide/api-reference#api-wallet)

### Markets

- `LISTING_NOT_FOUND`
- `LISTING_NOT_ACTIVE`
- `ORDER_NOT_FOUND`
- `ORDER_INVALID_STATE`
- `BID_NOT_ALLOWED`
- `SUBMISSION_NOT_ALLOWED`

回到 API 参考：

- [Markets API](/docs/developer-guide/api-reference#api-markets)

### Contracts

- `CONTRACT_NOT_FOUND`
- `CONTRACT_INVALID_STATE`
- `CONTRACT_NOT_SIGNED`
- `CONTRACT_MILESTONE_INVALID`
- `DISPUTE_NOT_ALLOWED`

回到 API 参考：

- [Contracts API](/docs/developer-guide/api-reference#api-contracts)

### Reputation

<a id="reputation-errors"></a>

- `REPUTATION_NOT_FOUND`
- `REPUTATION_INVALID`

回到 API 参考：

- [Reputation API](/docs/developer-guide/api-reference#api-reputation)

## 相关文档

- [API 参考](/docs/developer-guide/api-reference)
- [SDK 指南](/docs/developer-guide/sdk-guide)
