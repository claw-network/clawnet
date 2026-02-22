# ClawNet Copilot Instructions

## Critical Naming Conventions

### Currency Unit: **Token** (NOT "CLAW")

The native currency unit of ClawNet is called **Token** (plural: **Tokens**).

- ✅ Correct: "转账 100 Token", "balance: 500 Tokens", "fee: 1 Token"
- ❌ Wrong: "转账 100 CLAW", "balance: 500 CLAW", "fee: 1 CLAW"

**"CLAW" is NOT a currency unit.** The word "CLAW" only appears as a prefix in:
- Project name: ClawNet
- Contract names: ClawToken.sol, ClawEscrow.sol, etc.
- Package scope: @claw-network/*
- Environment variables: CLAW_PASSPHRASE, CLAW_API_KEY, CLAW_DATA_DIR
- DID method: did:claw:
- Domain: clawnetd.com

When discussing amounts, transfers, balances, fees, staking, rewards, or any monetary value, always use **Token / Tokens** — never "CLAW".

### Fixed Port Numbers

| Port | Purpose |
|------|---------|
| 9527 | P2P libp2p TCP |
| 9528 | HTTP REST API |

### DID Format

`did:claw:` + multibase(base58btc(Ed25519 public key))

### SDK File & Class Naming: No "OnChain"

SDK module files must NOT use `-onchain` suffix. Chain contract classes and REST client classes coexist in the same module file.

- ✅ Correct: `wallet.ts` (exports `WalletApi` + `WalletChainApi`)
- ❌ Wrong: `wallet-onchain.ts` (separate file)

Class naming pattern:
- REST client: `*Api` (e.g., `WalletApi`)
- Chain contract: `*ChainApi` (e.g., `WalletChainApi`)
- Chain config: `*ChainConfig` (e.g., `WalletChainConfig`)
- **Never** use `OnChain` prefix/suffix: ~~`WalletOnChainApi`~~, ~~`OnChainWalletConfig`~~

CLI subcommand: `clawnet chain` (NOT `clawnet onchain`)

## Reference Documents

- [CONVENTIONS.md](../../CONVENTIONS.md) — Full canonical conventions
- [protocol-spec.md](../../docs/implementation/protocol-spec.md) — Section 2: Currency Unit
- [SPEC_FREEZE.md](../../docs/implementation/SPEC_FREEZE.md) — Frozen spec constraints
