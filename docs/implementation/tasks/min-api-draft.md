# 最小 API 设计草案（模块级）

> 与 `protocol-spec.md` 事件模型对齐，提供最小可用接口。

## Identity

- POST /api/identity
  - 创建 DID
- GET /api/identity
  - 获取本节点 DID
- GET /api/identity/:did
  - 解析 DID
- POST /api/identity/capabilities
  - 注册能力

## Wallet

- GET /api/wallet/balance
- POST /api/wallet/transfer
- POST /api/wallet/escrow
- POST /api/wallet/escrow/:id/release
- POST /api/wallet/escrow/:id/refund

## Markets

- GET /api/markets/search
- POST /api/markets/listings
- PATCH /api/markets/listings/:id
- POST /api/markets/orders
- PATCH /api/markets/orders/:id
- POST /api/markets/bids
- POST /api/markets/submissions

## Contracts

- POST /api/contracts
- POST /api/contracts/:id/sign
- POST /api/contracts/:id/complete
- POST /api/contracts/:id/dispute

## Reputation

- GET /api/reputation/:did
- POST /api/reputation/record

