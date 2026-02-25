# Testnet Soft Multisig Runbook (No Hardware Wallet)

This directory provides an operational fallback for teams that cannot buy hardware wallets yet.
It helps 3 different people generate independent signer wallets and use them for Safe multisig.

Goal:

- Simulate hardware-wallet-style separation with 3 independent custodians.
- Keep private material local to each signer.
- Share only public signer addresses with the coordinator.

## Security Model

- Each signer generates wallet material on their own machine.
- Private keystore file never leaves signer machine.
- Signers only send `public-info.txt` (address + metadata) to the coordinator.
- Coordinator creates Safe with threshold `2/3` on ClawNet testnet (`chainId=7625`).

This is safer than a single shared private key, but weaker than hardware-wallet custody.

## Prerequisites (Each Signer)

- Docker installed locally.
- `ethereum/client-go:v1.13.15` image pullable.

## Step 1: Each Signer Creates One Wallet

Run on each signer's machine:

```bash
bash infra/testnet/multisig-soft-wallet/create-signer-wallet.sh --name signer1
```

The script will:

- Prompt for wallet passphrase (not echoed).
- Generate one EOA with geth account new.
- Save local keystore under `.generated/signer1/keystore/`.
- Write public metadata file: `.generated/signer1/public-info.txt`.

Signer should send only `public-info.txt` to coordinator.

## Step 2: Coordinator Collects 3 Public Files

Example:

```bash
bash infra/testnet/multisig-soft-wallet/collect-owner-addresses.sh \
  --input infra/testnet/multisig-soft-wallet/.generated/signer1/public-info.txt \
  --input infra/testnet/multisig-soft-wallet/.generated/signer2/public-info.txt \
  --input infra/testnet/multisig-soft-wallet/.generated/signer3/public-info.txt \
  --threshold 2
```

Output file:

- `infra/testnet/multisig-soft-wallet/.generated/safe-owners.env`

Contains deduplicated owners list and `SAFE_THRESHOLD` for Safe creation.

## Step 3: Create 2 Safe Wallets

Use the owners and threshold from `safe-owners.env` to create:

- `SAFE_LIQUIDITY_TESTNET` (for `LIQUIDITY_ADDRESS`)
- `SAFE_RESERVE_TESTNET` (for `RESERVE_ADDRESS`)

## Step 4: Wire Addresses into Redeploy

Update:

`infra/testnet/prod/secrets.env`

```bash
LIQUIDITY_ADDRESS=<SAFE_LIQUIDITY_ADDRESS>
RESERVE_ADDRESS=<SAFE_RESERVE_ADDRESS>
```

Then run redeploy:

```bash
cd infra/testnet/prod
bash deploy.sh
```

## Step 5: Verify Safe Address Type On-chain

For each Safe address, `eth_getCode` must return non-`0x`.

```bash
RPC="https://rpc.clawnetd.com"

curl -s "$RPC" -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["<SAFE_ADDRESS>","latest"],"id":1}'
```

## Suggested Operational Discipline

- Keep threshold `2/3` for testnet.
- Separate people/devices for signer roles.
- Do one low-value transaction drill before real treasury/liquidity usage.
- Rotate one signer at a time when needed.

## Important Limitations

- This is a temporary custody model for testnet and early operations.
- Hardware-wallet signers are still the long-term target.
