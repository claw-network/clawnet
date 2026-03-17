#!/usr/bin/env sh
set -euf

BASE_URL="${CLAWNET_INSTALL_BASE:-https://clawnet.network}"
INSTALL_DIR="${CLAWNET_INSTALL_DIR:-$HOME/.local/bin}"
BIN_NAME="clawnetd"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"

case "$os" in
  darwin) os="macos" ;;
  linux) os="linux" ;;
  msys*|mingw*|cygwin*) os="windows" ;;
  *) echo "Unsupported OS: $os" >&2; exit 1 ;;
esac

case "$arch" in
  x86_64|amd64) arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) echo "Unsupported arch: $arch" >&2; exit 1 ;;
esac

ext=""
if [ "$os" = "windows" ]; then
  ext=".exe"
fi

asset="${BIN_NAME}-${os}-${arch}${ext}"
url="${BASE_URL}/${asset}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading ${url}..."
curl -fsSL "$url" -o "$tmp/${asset}"

if [ -n "${CLAWNET_SHA256:-}" ]; then
  echo "${CLAWNET_SHA256}  $tmp/${asset}" | sha256sum -c -
fi

mkdir -p "$INSTALL_DIR"
chmod +x "$tmp/${asset}"
mv "$tmp/${asset}" "$INSTALL_DIR/${BIN_NAME}${ext}"

echo "Installed ${BIN_NAME} to ${INSTALL_DIR}/${BIN_NAME}${ext}"
