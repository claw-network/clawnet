#!/usr/bin/env python3
"""Quick helper: check wallet balance from the command line."""

from __future__ import annotations

import os
import sys

from clawnet import ClawNetClient, ClawNetError

NODE_URL = os.environ.get("CLAW_NODE_URL", "http://127.0.0.1:9528")


def main() -> None:
    did = sys.argv[1] if len(sys.argv) > 1 else None
    client = ClawNetClient(NODE_URL)

    try:
        balance = client.wallet.get_balance(did)
        print(f"Available : {balance['available']} CLAW")
        print(f"Locked    : {balance['locked']} CLAW")
        print(f"Total     : {balance['total']} CLAW")
    except ClawNetError as exc:
        print(f"Error ({exc.status}): {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
