---
title: "API Error Codes"
description: "Comprehensive error code catalog by domain"
---

> 对齐 `docs/api/openapi.yaml` 的错误返回格式。

通用错误格式:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

## 通用错误码

- INVALID_REQUEST (400): 请求参数错误
- UNAUTHORIZED (401): 未授权
- FORBIDDEN (403): 权限不足
- NOT_FOUND (404): 资源不存在
- CONFLICT (409): 状态冲突
- RATE_LIMITED (429): 请求过多
- INTERNAL_ERROR (500): 服务内部错误

## 身份相关

- DID_NOT_FOUND (404): DID 不存在
- DID_INVALID (400): DID 格式无效
- DID_UPDATE_CONFLICT (409): prevDocHash 不匹配
- CAPABILITY_INVALID (400): 能力注册参数错误

## 钱包相关

- INSUFFICIENT_BALANCE (402): 余额不足
- TRANSFER_NOT_ALLOWED (403): 转账不允许
- ESCROW_NOT_FOUND (404): 托管不存在
- ESCROW_INVALID_STATE (409): 托管状态不允许当前操作
- ESCROW_RULE_NOT_MET (409): 托管释放条件不满足

## 市场相关

- LISTING_NOT_FOUND (404): 商品不存在
- LISTING_NOT_ACTIVE (409): 商品不可用
- ORDER_NOT_FOUND (404): 订单不存在
- ORDER_INVALID_STATE (409): 订单状态不允许当前操作
- BID_NOT_ALLOWED (403): 竞标不允许
- SUBMISSION_NOT_ALLOWED (403): 提交不允许

## 合约相关

- CONTRACT_NOT_FOUND (404): 合约不存在
- CONTRACT_INVALID_STATE (409): 合约状态不允许当前操作
- CONTRACT_NOT_SIGNED (409): 合约未签署
- CONTRACT_MILESTONE_INVALID (400): 里程碑无效
- DISPUTE_NOT_ALLOWED (409): 争议不允许

## 信誉相关

- REPUTATION_NOT_FOUND (404): 信誉记录不存在
- REPUTATION_INVALID (400): 信誉记录无效
