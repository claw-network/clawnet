# ClawNet Bug Bounty Program — Draft

> **Status**: Draft — 待审核后发布  
> **Scope**: ClawNet 智能合约（9 UUPS 可升级合约）  
> **Platform**: Immunefi（推荐）或自建  

---

## 1. Program Overview

ClawNet Bug Bounty Program rewards security researchers who discover and responsibly disclose vulnerabilities in ClawNet's smart contracts. The program covers all deployed contracts on ClawNet Chain (chainId 7625/7626).

---

## 2. Scope

### In Scope

| Contract | Address | Priority |
|----------|---------|----------|
| ClawToken | See deployment manifest | Critical |
| ClawEscrow | See deployment manifest | Critical |
| ClawContracts | See deployment manifest | Critical |
| ClawDAO | See deployment manifest | Critical |
| ClawStaking | See deployment manifest | High |
| ClawIdentity | See deployment manifest | High |
| ClawReputation | See deployment manifest | Medium |
| ClawRouter | See deployment manifest | Medium |
| ParamRegistry | See deployment manifest | High |

**Source code**: `packages/contracts/contracts/*.sol`

### Out of Scope

- Frontend / website / documentation
- SDK and CLI (off-chain code)
- Node software (P2P, REST API)
- Third-party dependencies (OpenZeppelin) — report to their respective programs
- Known issues documented in [internal-audit-report.md](internal-audit-report.md)
- Findings already reported in Slither output (4 Medium false positives, 17 Low by-design)
- Testnet-only issues (e.g., test accounts, testnet Token value)
- Social engineering, phishing, DoS on infrastructure

---

## 3. Severity & Reward Tiers

Based on [Immunefi Vulnerability Severity Classification System v2.3](https://immunefi.com/severity-classification-system/).

### Smart Contract Vulnerabilities

| Severity | Description | Reward (USD) |
|----------|-------------|-------------|
| **Critical** | Direct theft of funds, permanent freezing of funds, unauthorized minting, proxy storage collision leading to fund loss | $10,000 – $50,000 |
| **High** | Theft of unclaimed yield/fees, permanent freezing of unclaimed yield, temporary freezing of funds (>7 days), unauthorized role escalation | $5,000 – $10,000 |
| **Medium** | Griefing (no direct fund loss), temporary freezing of funds (<7 days), governance manipulation without fund theft, gas optimization with security implications | $1,000 – $5,000 |
| **Low** | Contract state inconsistency without fund risk, events not emitted, view function returns incorrect values | $500 – $1,000 |

### Reward Conditions

- Rewards are paid in USDC (or equivalent stablecoin)
- Reward amount within each tier depends on impact severity and likelihood
- First valid report for a specific vulnerability receives the full reward
- Duplicate reports receive no reward
- Reports must include a working proof of concept (PoC) for Critical and High

---

## 4. Vulnerability Categories

### Critical Priority Focus Areas

1. **Token theft**: Unauthorized `transfer`, `transferFrom`, or `mint` bypassing access control
2. **Escrow drain**: Withdrawing funds without proper authorization (release/refund/resolve bypass)
3. **Proxy upgrade hijack**: Unauthorized `upgradeTo` call that replaces implementation
4. **Storage collision**: UUPS proxy storage layout incompatibility across upgrades
5. **Reentrancy**: Despite `ReentrancyGuardUpgradeable`, any cross-contract reentrancy path
6. **Access control bypass**: Gaining `DEFAULT_ADMIN_ROLE`, `MINTER_ROLE`, `SLASHER_ROLE` etc. without authorization

### High Priority Focus Areas

1. **DAO governance manipulation**: Vote double-counting, snapshot bypass, quorum manipulation
2. **Staking reward inflation**: Claiming more rewards than entitled, reward distribution errors
3. **Escrow fee manipulation**: Bypassing fee calculation to avoid protocol fees
4. **Emergency multi-sig bypass**: Circumventing the 5-of-9 requirement
5. **Service contract milestone manipulation**: Approving milestones without proper authorization

### Medium Priority Focus Areas

1. **DID spoofing**: Registering a DID that conflicts with another user's identity
2. **Reputation score manipulation**: Anchoring false reputation data
3. **Parameter registry abuse**: Setting parameters to extreme values (even with governance)
4. **Griefing attacks**: Blocking other users' transactions without direct fund theft

---

## 5. Rules of Engagement

### Responsible Disclosure

1. **Do NOT** publicly disclose vulnerabilities before they are fixed
2. **Do NOT** exploit vulnerabilities on mainnet for personal gain
3. **Do NOT** access or modify other users' data beyond what's necessary to demonstrate the vulnerability
4. Testing on public testnet (chainId 7625) is allowed
5. Testing on local fork (Hardhat) is encouraged

### Reporting Requirements

Each report must include:

1. **Summary**: One-paragraph description of the vulnerability
2. **Severity**: Self-assessed severity (Critical/High/Medium/Low)
3. **Affected contract(s)**: Contract name and function(s)
4. **Impact**: What can an attacker achieve?
5. **Proof of Concept**: Hardhat test script or transaction sequence demonstrating the issue
6. **Suggested fix**: Optional but appreciated

### Submission

- **Platform**: Immunefi dashboard (preferred)
- **Email**: security@clawnetd.com (backup)
- **PGP key**: Available at `https://clawnetd.com/.well-known/security.txt`

### Response SLA

| Action | Timeline |
|--------|----------|
| Acknowledgment | 24 hours |
| Triage & severity assessment | 3 business days |
| Fix development | 7 business days (Critical), 14 business days (High) |
| Reward payment | 14 business days after fix verified |

---

## 6. Exclusions (Not Eligible for Reward)

- Vulnerabilities requiring physical access to user's device
- Vulnerabilities in third-party dependencies (report to their bounty programs)
- Issues already known (see [internal-audit-report.md](internal-audit-report.md) §4 Known Issues):
  - `block.timestamp` usage for time checks (by design, Low)
  - `getActiveValidators()` unbounded loop (capped by practical count, Low)
  - Batched `distributeRewards()` gas cost (bounded, Low)
  - Emergency multi-sig bypass (by design, documented)
  - Ed25519 `verify()` placeholder (documented, Phase 2)
- Theoretical attacks without a working PoC
- Best practice suggestions without security impact
- Gas optimization suggestions without security implications

---

## 7. Legal Safe Harbor

ClawNet will not initiate legal action against researchers who:

- Act in good faith and follow this program's rules
- Make reasonable effort to avoid privacy violations, data destruction, and service interruption
- Do not exploit found vulnerabilities beyond proof of concept
- Report findings promptly and do not disclose publicly until authorized

---

## 8. Program Administration

| Role | Contact |
|------|---------|
| Program manager | PM (TBD) |
| Technical triage | Core contract engineering team |
| Payment approval | Treasury multi-sig |

### Budget

- Initial program budget: $100,000 USD (6-month period)
- Funded from protocol treasury
- Renewed quarterly based on program activity

### Program Launch Checklist

- [ ] Finalize reward amounts with team
- [ ] Set up Immunefi listing (or self-hosted alternative)
- [ ] Create `security@clawnetd.com` mailbox
- [ ] Publish PGP key at `.well-known/security.txt`
- [ ] Deploy contracts to mainnet (chainId 7626)
- [ ] Announce program on social channels
- [ ] Brief support team on vulnerability report handling

---

## Appendix: Contract Security Features Summary

| Feature | Implementation |
|---------|---------------|
| Upgrade safety | UUPS proxy, `_authorizeUpgrade` requires `DEFAULT_ADMIN_ROLE` |
| Access control | OpenZeppelin `AccessControlUpgradeable`, role-based |
| Reentrancy protection | `ReentrancyGuardUpgradeable` on Escrow, Staking, DAO, Contracts |
| Pausability | `PausableUpgradeable` on all contracts except Router & ParamRegistry |
| Integer safety | Solidity 0.8.28 built-in overflow/underflow protection |
| Safe transfers | `SafeERC20` for all token interactions |
| Storage gaps | `uint256[50] private __gap` in all contracts |
| No selfdestruct | None of the contracts use `selfdestruct` |
| No delegatecall | Only UUPS internal delegatecall to implementation |
