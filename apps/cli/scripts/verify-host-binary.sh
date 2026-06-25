#!/usr/bin/env bash
# Verify the host release binary exists, checksum matches, and boots as Kunai.
#
# Usage:
#   bash apps/cli/scripts/verify-host-binary.sh
#   bash apps/cli/scripts/verify-host-binary.sh --skip-smoke
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT/dist/bin"
SKIP_SMOKE=0

for arg in "$@"; do
  case "$arg" in
    --skip-smoke) SKIP_SMOKE=1 ;;
    -h | --help)
      sed -n '2,6p' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

TARGET_JSON="$(cd "$ROOT" && bun -e "
import { isMuslEnvironmentSync } from './src/services/update/native-installer/musl.ts';
import { resolveHostReleaseBinaryTarget } from './src/services/update/platform-assets.ts';
const libc = process.platform === 'linux' && isMuslEnvironmentSync() ? 'musl' : 'gnu';
const target = resolveHostReleaseBinaryTarget({ libc });
console.log(JSON.stringify({ id: target.id, out: target.out }));
")"

ASSET="$(printf '%s' "$TARGET_JSON" | bun -e "const j=JSON.parse(await Bun.stdin.text()); console.log(j.out)")"
TARGET_ID="$(printf '%s' "$TARGET_JSON" | bun -e "const j=JSON.parse(await Bun.stdin.text()); console.log(j.id)")"

if [[ ! -f "$BIN_DIR/$ASSET" ]]; then
  echo "✗ missing $BIN_DIR/$ASSET (host target: $TARGET_ID)" >&2
  echo "  build it with: bun run build:binary:host" >&2
  exit 1
fi

if [[ ! -f "$BIN_DIR/SHA256SUMS" ]]; then
  echo "✗ missing $BIN_DIR/SHA256SUMS" >&2
  exit 1
fi

if ! grep -q "  $ASSET\$" "$BIN_DIR/SHA256SUMS"; then
  echo "✗ $ASSET not listed in SHA256SUMS" >&2
  exit 1
fi

(
  cd "$BIN_DIR"
  sha256sum -c SHA256SUMS 2>/dev/null | grep -q "^$ASSET: OK$" || {
    echo "✗ checksum mismatch for $ASSET" >&2
    exit 1
  }
)

if [[ "$SKIP_SMOKE" -eq 0 ]]; then
  version_out="$("$BIN_DIR/$ASSET" --version)"
  echo "$version_out"
  grep -q '^kunai ' <<<"$version_out" || {
    echo "✗ $ASSET --version must print kunai semver, not Bun runtime" >&2
    exit 1
  }
  "$BIN_DIR/$ASSET" --help >/dev/null
fi

echo "✓ host binary verified ($TARGET_ID → $ASSET)"
