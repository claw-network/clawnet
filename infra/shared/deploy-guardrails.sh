#!/usr/bin/env bash

shell_quote() {
  printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\\''/g")"
}

normalize_arch() {
  case "$1" in
    x86_64|amd64)
      echo "amd64"
      ;;
    aarch64|arm64)
      echo "arm64"
      ;;
    *)
      echo "$1"
      ;;
  esac
}

debug_remote_clawnetd() {
  local host="$1"
  run_remote "$host" "systemctl status clawnetd --no-pager -n 80 || true"
  run_remote "$host" "journalctl -u clawnetd -n 120 --no-pager || true"
}

wait_for_remote_clawnetd_health() {
  local host="$1"
  local label="$2"
  local attempt

  for attempt in 1 2 3 4 5; do
    if run_remote "$host" "systemctl is-active clawnetd >/dev/null && curl -sf http://127.0.0.1:9528/api/v1/node >/dev/null"; then
      echo "  [$label] clawnetd health check passed (attempt $attempt)."
      return 0
    fi
    sleep 3
  done

  echo "ERROR: [$label] clawnetd failed health checks after restart"
  debug_remote_clawnetd "$host"
  exit 1
}

prepare_remote_repo() {
  local host="$1"
  local dirty_status
  local stash_label

  dirty_status="$(run_remote "$host" "cd /opt/clawnet && git status --porcelain")"
  if [[ -n "$dirty_status" ]]; then
    if [[ "${CLAWNET_AUTO_STASH_REMOTE_REPO:-1}" != "1" ]]; then
      echo "ERROR: remote repository on $host is dirty and CLAWNET_AUTO_STASH_REMOTE_REPO=0"
      printf '%s\n' "$dirty_status"
      exit 1
    fi

    stash_label="auto-stash-${DEPLOY_STASH_SCOPE:-deploy}-${DEPLOY_RUN_ID:?DEPLOY_RUN_ID is required}"
    echo "  [$host] Remote repo dirty; stashing as $stash_label"
    run_remote "$host" "cd /opt/clawnet && git stash push -u -m $(shell_quote "$stash_label") >/dev/null"
  fi

  echo "  [$host] git pull --ff-only..."
  run_remote "$host" "cd /opt/clawnet && git pull --ff-only"
}

ensure_remote_besu_image_ready() {
  local host="$1"
  local image="${CLAWNET_BESU_IMAGE:?CLAWNET_BESU_IMAGE is required}"
  local quoted_image
  local remote_arch
  local image_arch

  quoted_image="$(shell_quote "$image")"

  echo "  [$host] Pre-pulling Besu image..."
  if ! run_remote "$host" "docker pull $quoted_image >/dev/null"; then
    if [[ "$image" == ghcr.io/* ]]; then
      if [[ -z "${GHCR_USERNAME:-}" || -z "${GHCR_TOKEN:-}" ]]; then
        echo "ERROR: failed to pull $image on $host. Set GHCR_USERNAME and GHCR_TOKEN for private GHCR images."
        exit 1
      fi

      echo "  [$host] GHCR pull failed; logging into ghcr.io and retrying..."
      run_remote "$host" "printf '%s\n' $(shell_quote "$GHCR_TOKEN") | docker login ghcr.io -u $(shell_quote "$GHCR_USERNAME") --password-stdin >/dev/null"
      run_remote "$host" "docker pull $quoted_image >/dev/null"
    else
      echo "ERROR: failed to pull Besu image on $host: $image"
      exit 1
    fi
  fi

  remote_arch="$(normalize_arch "$(run_remote "$host" "uname -m")")"
  image_arch="$(normalize_arch "$(run_remote "$host" "docker image inspect $quoted_image --format '{{.Architecture}}'")")"

  echo "  [$host] Host arch=$remote_arch image arch=$image_arch"
  if [[ "$remote_arch" != "$image_arch" ]]; then
    echo "ERROR: Besu image architecture mismatch on $host (host=$remote_arch image=$image_arch image=$image)"
    exit 1
  fi
}
