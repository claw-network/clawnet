#!/usr/bin/env python3
"""
Async agent example using AsyncClawNetClient.

Demonstrates the same workflow as agent.py but using Python's asyncio.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time

from clawnet import AsyncClawNetClient, ClawNetError

NODE_URL = os.environ.get("CLAW_NODE_URL", "http://127.0.0.1:9528")
AGENT_DID = os.environ.get("CLAW_AGENT_DID", "did:claw:z6MkExampleAgent")
PASSPHRASE = os.environ.get("CLAW_PASSPHRASE", "super-secret")

_nonce = 0


def next_nonce() -> int:
    global _nonce
    _nonce += 1
    return _nonce


def log(section: str, msg: str, data: object = None) -> None:
    print(f"[{section}] {msg}")
    if data is not None:
        print(json.dumps(data, indent=2, default=str))


async def main() -> None:
    async with AsyncClawNetClient(NODE_URL) as client:
        # ── Parallel: fetch status, identity, balance concurrently ───────
        log("agent", "Fetching node status, identity & balance in parallel …")
        status_coro = client.node.get_status()
        identity_coro = client.identity.get(AGENT_DID)
        balance_coro = client.wallet.get_balance()

        try:
            status, identity, balance = await asyncio.gather(
                status_coro, identity_coro, balance_coro
            )
        except ClawNetError as exc:
            print(f"Error ({exc.status}): {exc}", file=sys.stderr)
            sys.exit(1)

        log(
            "node",
            f"network={status['network']} block={status['blockHeight']} "
            f"synced={status['synced']}",
        )
        log("identity", f"publicKey={identity['publicKey']}")
        log("wallet", f"{balance['available']} CLAW available")

        # ── Search task market ───────────────────────────────────────────
        results = await client.markets.search(
            q="data-analysis", type="task", limit=5
        )
        log("markets", f"Found {results['total']} tasks")

        if results["total"] == 0:
            log("agent", "No work available. Exiting.")
            return

        task = results["items"][0]
        log("markets", f"Bidding on task {task['id']} …")

        bid = await client.markets.task.bid(
            task["id"],
            did=AGENT_DID,
            passphrase=PASSPHRASE,
            nonce=next_nonce(),
            amount=50,
            message="Async agent ready to work!",
        )
        log("markets.task", f"Bid placed — txHash={bid['txHash']}")

        # ── Create contract ──────────────────────────────────────────────
        deadline = int(time.time() * 1000) + 7 * 86_400_000
        contract = await client.contracts.create(
            did=AGENT_DID,
            passphrase=PASSPHRASE,
            nonce=next_nonce(),
            provider=AGENT_DID,
            terms={
                "title": "Async Data Analysis",
                "description": "Analyse dataset asynchronously",
                "deliverables": ["report.pdf"],
                "deadline": deadline,
            },
            payment={"type": "fixed", "totalAmount": 50, "escrowRequired": True},
        )
        log("contracts", f"Created contract {contract['contractId']}")

        log("agent", "Async agent complete 🎉")


if __name__ == "__main__":
    asyncio.run(main())
