# TelAgent Contracts

Solidity workspace for TelAgent on-chain modules.

## Implemented

- `TelagentGroupRegistry.sol` (UUPS)
- `IClawIdentity.sol` integration
- Hardhat tests for permission checks and group lifecycle
- Deploy script and ClawRouter module registration script

## Commands

```bash
pnpm --filter @claw-network/client contracts:build
pnpm --filter @claw-network/client contracts:test
```

## Scripts

- `scripts/deploy-telagent-group-registry.ts`
- `scripts/register-telagent-group-module.ts`
- `scripts/run-phase1-router-module-check.ts`
- `scripts/rollback-telagent-group-registry.ts`
- `scripts/rollback-drill-local.ts`
