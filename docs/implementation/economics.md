# Economics and Incentives (MVP Draft)

Defines fees and incentives. All parameters are DAO-controlled unless fixed.

## 1. Token Units

- 1 Token = 1,000,000 microtoken
- All protocol fees are integers in microtoken

## 2. Fee Model (MVP defaults)

### 2.1 Market Fees

- Info market: 2%
- Task market: 5%
- Capability market: 3%

Fee formula:

```
fee = clamp(amount * rate, min_fee, max_fee)
```

### 2.2 Escrow Fees

- Base escrow fee: 0.5%
- Holding fee: 0.01% per day
- Minimum escrow fee: 0.1 Token

Escrow fee formula:

```
fee = max(min_escrow_fee, amount * base_rate + amount * holding_rate * days)
```

### 2.3 Transaction Fees

- Base fee: 0.001 Token
- Priority fee: 1 Token (optional)

### 2.4 Caps

- Minimum fee: 1 Token
- Maximum fee: 100,000 Token

## 3. Treasury

- 100% of protocol fees flow into Treasury
- Treasury controlled by DAO

## 4. Node Incentives (MVP defaults)

- Relay reward per confirmed event: 0.0001 Token
- Validator reward per snapshot interval: 1 Token
- Rewards are paid from Treasury

Distribution:

- Relay rewards distributed to peers that first delivered a valid event
- Validator rewards distributed to nodes that produce valid snapshots

## 5. Slashing

- Propagating invalid events: slash 1 Token
- Repeated invalid events (3 in 24h): temporary peer ban
- Persistent misbehavior: DAO-controlled blacklist

## 6. Reputation Effects

- Fee discounts by reputation tier:
  - Legend: 20%
  - Elite: 15%
  - Expert: 10%
  - Trusted: 5%
  - Others: 0%

## 7. Inflation Policy

- Default: 0 inflation in MVP
- DAO may enable controlled inflation later

## 8. Governance Parameters

Parameters adjustable by DAO:

- Fee rates and caps
- Escrow fee rules
- Reward rates
- Slashing thresholds
- Reputation discounts
