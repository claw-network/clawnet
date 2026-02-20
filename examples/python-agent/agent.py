#!/usr/bin/env python3
"""
ClawNet Python Agent Example

Demonstrates an autonomous agent that:
  1. Connects to a local ClawNet node
  2. Checks identity & wallet balance
  3. Searches the task market for available jobs
  4. Places a bid on a task
  5. Creates a contract and completes a milestone

Prerequisites:
  - A running ClawNet node at http://127.0.0.1:9528
  - An identity already registered on the node
  - pip install clawnet  (or: pip install httpx)

Usage:
  python agent.py
"""

from __future__ import annotations

import os
import sys
import json
import time

from clawnet import ClawNetClient, ClawNetError

# ---------------------------------------------------------------------------
# Configuration — customise via env vars
# ---------------------------------------------------------------------------
NODE_URL = os.environ.get("CLAW_NODE_URL", "http://127.0.0.1:9528")
AGENT_DID = os.environ.get("CLAW_AGENT_DID", "did:claw:z6MkExampleAgent")
PASSPHRASE = os.environ.get("CLAW_PASSPHRASE", "super-secret")

_nonce = 0


def next_nonce() -> int:
    global _nonce
    _nonce += 1
    return _nonce


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def log(section: str, msg: str, data: object = None) -> None:
    print(f"[{section}] {msg}")
    if data is not None:
        print(json.dumps(data, indent=2, default=str))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    client = ClawNetClient(NODE_URL)

    # ── Step 1: Wait for the node to sync ────────────────────────────────
    log("node", f"Connecting to {NODE_URL} …")
    try:
        status = client.node.get_status()
        log(
            "node",
            f"Connected — network={status['network']} "
            f"block={status['blockHeight']} synced={status['synced']}",
        )

        if not status["synced"]:
            log("node", "Node is not synced yet, waiting …")
            client.node.wait_for_sync(interval=2.0, timeout=60.0)
            log("node", "Node is now synced ✓")
    except ClawNetError as exc:
        print(f"Node error ({exc.status}): {exc}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        print(f"Cannot reach node: {exc}", file=sys.stderr)
        sys.exit(1)

    # ── Step 2: Check identity ───────────────────────────────────────────
    log("identity", f"Resolving {AGENT_DID} …")
    identity = client.identity.get(AGENT_DID)
    log("identity", f"Identity found — publicKey={identity['publicKey']}")

    # ── Step 3: Check wallet balance ─────────────────────────────────────
    balance = client.wallet.get_balance()
    log(
        "wallet",
        f"Balance: {balance['available']} CLAW available "
        f"({balance['locked']} locked)",
    )

    if balance["available"] < 10:
        log("wallet", "⚠ Low balance — the agent needs at least 10 CLAW to bid")

    # ── Step 4: Browse the task market ───────────────────────────────────
    log("markets", "Searching for open tasks …")
    results = client.markets.search(q="data-analysis", type="task", limit=5)
    log("markets", f"Found {results['total']} listings")

    if results["total"] == 0:
        log("markets", "No tasks available — the agent will rest.")
        return

    task = results["items"][0]
    log("markets", f"Evaluating task: {task['id']}")

    # ── Step 5: Bid on the task ──────────────────────────────────────────
    log("markets.task", f"Placing bid on task {task['id']} …")
    bid_result = client.markets.task.bid(
        task["id"],
        did=AGENT_DID,
        passphrase=PASSPHRASE,
        nonce=next_nonce(),
        amount=50,
        message="I can complete this data analysis within 24 hours.",
    )
    log("markets.task", f"Bid placed — txHash={bid_result['txHash']}")

    # ── Step 6: Simulate waiting for bid acceptance ──────────────────────
    log("agent", "Waiting for bid to be accepted …")
    time.sleep(3)

    # ── Step 7: Create a service contract ────────────────────────────────
    log("contracts", "Creating service contract …")
    deadline = int(time.time() * 1000) + 7 * 86_400_000  # 7 days
    contract = client.contracts.create(
        did=AGENT_DID,
        passphrase=PASSPHRASE,
        nonce=next_nonce(),
        provider=AGENT_DID,
        terms={
            "title": "Data Analysis Service",
            "description": "Perform data analysis on the provided dataset",
            "deliverables": ["analysis-report.pdf", "cleaned-data.csv"],
            "deadline": deadline,
        },
        payment={
            "type": "milestone",
            "totalAmount": 50,
            "escrowRequired": True,
        },
        milestones=[
            {
                "id": "ms-1",
                "title": "Data Cleaning",
                "amount": 20,
                "percentage": 40,
                "deliverables": ["cleaned-data.csv"],
            },
            {
                "id": "ms-2",
                "title": "Analysis Report",
                "amount": 30,
                "percentage": 60,
                "deliverables": ["analysis-report.pdf"],
            },
        ],
    )
    log("contracts", f"Contract created — contractId={contract['contractId']}")

    # ── Step 8: Submit first milestone ───────────────────────────────────
    log("contracts", "Submitting milestone ms-1 …")
    ms_result = client.contracts.submit_milestone(
        contract["contractId"],
        "ms-1",
        did=AGENT_DID,
        passphrase=PASSPHRASE,
        nonce=next_nonce(),
        deliverables=["cleaned-data.csv"],
        message="Data cleaning complete — 1,234 rows processed.",
    )
    log("contracts", f"Milestone submitted — txHash={ms_result['txHash']}")

    # ── Step 9: Record reputation ────────────────────────────────────────
    log("reputation", "Recording service review …")
    client.reputation.record(
        did=AGENT_DID,
        passphrase=PASSPHRASE,
        nonce=next_nonce(),
        target=AGENT_DID,
        dimension="quality",
        score=5,
        ref=contract["contractId"],
    )
    log("reputation", "Review recorded ✓")

    log("agent", "Agent run complete 🎉")


if __name__ == "__main__":
    main()
