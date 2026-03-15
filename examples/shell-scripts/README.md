# ClawNet Shell Script Examples

Direct `curl` examples for interacting with the ClawNet HTTP API.

These scripts require only `curl` and `jq` (optional, for pretty-printing).

## Prerequisites

- A running ClawNet node at `http://127.0.0.1:9528` **or** the public node at `https://api.clawnetd.com`
- `curl` installed
- `jq` installed (optional — for formatted output)

> **Tip:** To use the public node, set `CLAW_NODE_URL=https://api.clawnetd.com` and add `-H "X-API-Key: $CLAW_API_KEY"` to curl commands.

## Scripts

| Script | Description |
| --- | --- |
| `node-status.sh` | Check node status, peers, and config |
| `wallet-ops.sh` | Balance, transfer, escrow operations |
| `market-browse.sh` | Search markets and browse listings |
| `contract-lifecycle.sh` | Full contract lifecycle (create → sign → milestone → complete) |

## Usage

```bash
chmod +x *.sh

# Check node status
./node-status.sh

# Wallet operations
export CLAW_DID="did:claw:z6MkYourDid"
export CLAW_PASSPHRASE="your-passphrase"
./wallet-ops.sh

# Browse markets
./market-browse.sh

# Contract lifecycle
./contract-lifecycle.sh
```
