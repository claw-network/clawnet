#!/bin/sh
# Peer entrypoint — discover bootstrap node's PeerId before starting
# Usage: entrypoint-peer.sh --bootstrap-api <url> [daemon args...]

set -e

BOOTSTRAP_API=""
DAEMON_ARGS=""

# Parse --bootstrap-api from args
while [ $# -gt 0 ]; do
  case "$1" in
    --bootstrap-api)
      BOOTSTRAP_API="$2"
      shift 2
      ;;
    *)
      DAEMON_ARGS="$DAEMON_ARGS $1"
      shift
      ;;
  esac
done

if [ -z "$BOOTSTRAP_API" ]; then
  echo "[entrypoint] No --bootstrap-api specified, starting without bootstrap peers"
  exec node packages/node/dist/daemon.js $DAEMON_ARGS
fi

echo "[entrypoint] Waiting for bootstrap node at $BOOTSTRAP_API ..."
MAX_RETRIES=30
RETRY=0
PEER_ID=""

while [ $RETRY -lt $MAX_RETRIES ]; do
  RESP=$(wget -qO- "$BOOTSTRAP_API/api/node/status" 2>/dev/null || true)
  if [ -n "$RESP" ]; then
    # Extract peerId from JSON using simple grep
    PEER_ID=$(echo "$RESP" | sed 's/.*"peerId":"\([^"]*\)".*/\1/' 2>/dev/null || true)
    if [ -n "$PEER_ID" ]; then
      break
    fi
  fi
  RETRY=$((RETRY + 1))
  echo "[entrypoint] Bootstrap not ready (attempt $RETRY/$MAX_RETRIES)..."
  sleep 2
done

if [ -z "$PEER_ID" ]; then
  echo "[entrypoint] ERROR: Could not discover bootstrap PeerId after $MAX_RETRIES attempts"
  exit 1
fi

BOOTSTRAP_HOST=$(echo "$BOOTSTRAP_API" | sed 's|http://||' | sed 's|:.*||')
BOOTSTRAP_MULTIADDR="/dns4/$BOOTSTRAP_HOST/tcp/9527/p2p/$PEER_ID"

echo "[entrypoint] Discovered bootstrap: $BOOTSTRAP_MULTIADDR"
exec node packages/node/dist/daemon.js $DAEMON_ARGS --bootstrap "$BOOTSTRAP_MULTIADDR"
