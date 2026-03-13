# 2026-03-13 Besu Ed25519 Testnet Rollout

## Summary

- Custom Besu Ed25519 image rolled out to all three ClawNet testnet validators.
- Final rollout image:
  - `ghcr.io/claw-network/besu-ed25519:24.12.2-494c77f440-amd64`
- Final rollout digest:
  - `sha256:d382a32799010d236b709503b39356deb66119cb8fee0d96455116d8433d1725`
- Besu fork commit:
  - `494c77f440`

## Notable Issues During Rollout

- Initial shared GHCR artifact was `linux/arm64` and failed on the amd64 validators with `exec format error`.
- Server-side repositories had dirty generated files and required `git stash push -u` before deployment could proceed.
- GHCR package pulls required explicit `docker login ghcr.io` on all three servers.
- `infra/testnet/prod/deploy.sh` exited during the phase-14 `clawnetd` handoff; Server B needed a manual `systemctl daemon-reload && systemctl enable clawnetd && systemctl restart clawnetd` recovery.

## Validation Performed

### Direct Probe on Testnet

Command used on Server A:

```bash
cd /opt/clawnet

DEPLOYER_PRIVATE_KEY=<testnet-deployer-private-key> \
CLAWNET_BESU_TEST_NETWORK=clawnetTestnet \
CLAWNET_RPC_URL=http://127.0.0.1:8545 \
node scripts/test-ed25519-precompile.mjs
```

Result:

- `valid: true`
- `invalid: false`

### Focused Contract Test on Testnet

Command used on Server A:

```bash
cd /opt/clawnet

DEPLOYER_PRIVATE_KEY=<testnet-deployer-private-key> \
CLAWNET_BESU_TEST_NETWORK=clawnetTestnet \
CLAWNET_BESU_PRECOMPILE_TEST=1 \
CLAWNET_RPC_URL=http://127.0.0.1:8545 \
pnpm contracts:test:ed25519:besu
```

Result:

- `1 passing (6s)`

## Post-Rollout Health Snapshot

- Server A `66.94.125.242`: `eth_blockNumber=252`, `net_peerCount=2`, `clawnetd=active`
- Server B `85.239.236.49`: `eth_blockNumber=253`, `net_peerCount=2`, `clawnetd=active`
- Server C `85.239.235.67`: `eth_blockNumber=255`, `net_peerCount=2`, `clawnetd=active`

## Immediate Follow-Up

- Continue observation-window monitoring before any main-path contract-side adoption decision.
- Rotate the GHCR token that was pasted into chat and used for the package publication and server logins.
