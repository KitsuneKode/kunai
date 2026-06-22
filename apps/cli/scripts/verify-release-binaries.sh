#!/usr/bin/env bash
# Verify all release binary targets exist, checksums match, and linux-x64 boots as Kunai.
#
# Usage:
#   bash apps/cli/scripts/verify-release-binaries.sh
#   bash apps/cli/scripts/verify-release-binaries.sh --partial   # only entries in SHA256SUMS
#   bash apps/cli/scripts/verify-release-binaries.sh --skip-version-smoke
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT/dist/bin"
SKIP_VERSION=0
PARTIAL=0

for arg in "$@"; do
  case "$arg" in
    --skip-version-smoke) SKIP_VERSION=1 ;;
    --partial) PARTIAL=1 ;;
    -h | --help)
      sed -n '2,6p' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

ASSETS=(
  kunai-linux-x64
  kunai-linux-arm64
  kunai-linux-x64-musl
  kunai-linux-arm64-musl
  kunai-darwin-x64
  kunai-darwin-arm64
  kunai-windows-x64.exe
  kunai-windows-arm64.exe
)

if [[ "$PARTIAL" -eq 1 ]]; then
  if [[ ! -f "$BIN_DIR/SHA256SUMS" ]]; then
    echo "✗ missing $BIN_DIR/SHA256SUMS" >&2
    exit 1
  fi
  mapfile -t ASSETS < <(awk '{print $2}' "$BIN_DIR/SHA256SUMS")
fi

missing=0
for asset in "${ASSETS[@]}"; do
  if [[ ! -f "$BIN_DIR/$asset" ]]; then
    echo "✗ missing $BIN_DIR/$asset" >&2
    missing=1
  fi
done
if [[ "$missing" -ne 0 ]]; then
  exit 1
fi

if [[ ! -f "$BIN_DIR/SHA256SUMS" ]]; then
  echo "✗ missing $BIN_DIR/SHA256SUMS" >&2
  exit 1
fi

(
  cd "$BIN_DIR"
  sha256sum -c SHA256SUMS
)

if [[ "$SKIP_VERSION" -eq 0 && -f "$BIN_DIR/kunai-linux-x64" ]]; then
  version_out="$("$BIN_DIR/kunai-linux-x64" --version)"
  echo "$version_out"
  grep -q '^kunai ' <<<"$version_out" || {
    echo "✗ kunai-linux-x64 --version must print kunai semver, not Bun runtime" >&2
    exit 1
  }
  "$BIN_DIR/kunai-linux-x64" --help >/dev/null
fi

echo "✓ release binaries verified (${#ASSETS[@]} targets + SHA256SUMS)"
