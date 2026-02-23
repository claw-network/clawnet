# Economics and Incentives (MVP Draft)

Defines fees and incentives. All parameters are DAO-controlled unless fixed.

## 1. Token Units

- 1 Token is the smallest unit.
- All protocol amounts and fees are integers in Token.

## 2. Fee Model (MVP defaults)

### 2.1 Market Fees

- Info market: 2%
- Task market: 5%
- Capability market: 3%

Fee formula (market fees only):

```
fee = clamp(floor(amount * rate), market_min_fee, market_max_fee)
```

Market fee bounds:

- market_min_fee: 1 Token
- market_max_fee: 100,000 Token

### 2.2 Escrow Fees

- Base escrow fee: 0.5%
- Holding fee: 0.01% per day
- Minimum escrow fee: 1 Token

Escrow fee formula:

```
fee = max(min_escrow_fee, ceil(amount * base_rate + amount * holding_rate * days))
```

Notes:
- Escrow fees are not subject to market_min_fee/market_max_fee.
- Protocol escrow fees are now auto-deducted on-chain by ClawEscrow.sol during the `release()` call. The contract calculates the fee using the formula above, deducts it from the released amount, and forwards it to the Treasury address — no off-chain fee calculation is required.

### 2.3 Transaction Fees

- Base fee: 1 Token
- Priority fee: 1 Token (optional)

Notes:
- Transaction fees are fixed values and not subject to market fee caps.

#### Gas Fees vs Protocol Fees

On the ClawNet EVM chain, every write transaction incurs a **Gas fee** (paid in Token as the native gas currency) in addition to the **protocol fee** described above. Gas fees compensate validators for executing the transaction; protocol fees are application-level charges that flow to the Treasury. During the PoA phase, 100% of Gas revenue goes to the protocol treasury. In the PoS phase, Gas revenue is split between validators and the treasury at a DAO-controlled ratio.

### 2.4 Market Fee Caps

Market fee caps apply only to market fees (Section 2.1).

### 2.5 Minimum Amounts (Anti-dust)

DAO-controlled thresholds to prevent state bloat and spam:

- MIN_TRANSFER_AMOUNT: 1 Token
- MIN_ESCROW_AMOUNT: 1 Token

Notes:
- Nodes MUST reject wallet transfers or escrow creates below these thresholds.

## 3. Treasury

- 100% of protocol fees flow into Treasury
- Treasury controlled by DAO

## 4. Node Incentives (MVP defaults)

- Validator reward per snapshot interval: 1 Token
- Relay reward per confirmed event: 1 Token (optional, non-consensus)
- Rewards paid from Treasury MUST be deterministic

Distribution:

- Validator rewards distributed to nodes that produce valid snapshots
- Relay rewards MUST NOT use "first seen" attribution for consensus payouts.
  If relay rewards are enabled, they MUST be paid off-chain or via a deterministic
  on-chain rule defined by DAO.

On-chain implementation: Validator rewards are distributed via `ClawStaking.distributeRewards()`. The contract tracks each validator's stake weight and distributes proceeds proportionally at the end of each epoch. Reward amounts are DAO-configurable through ParamRegistry.

## 5. Slashing

- Propagating invalid events: slash 1 Token
- Repeated invalid events (3 in 24h): temporary peer ban
- Persistent misbehavior: DAO-controlled blacklist

Slashing is enforced on-chain via `ClawStaking.slash(nodeAddress, amount, reason)`. When a slashing condition is detected (by any authorized reporter), the staked Token balance of the offending node is reduced atomically. Slashed funds are forwarded to the Treasury. Slashing thresholds and cooldown periods are DAO-controlled through ParamRegistry.

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
