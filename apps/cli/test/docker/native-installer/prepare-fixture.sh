#!/usr/bin/env bash
# Build a local mock GitHub Releases tree for installer smoke tests.
#
# Usage:
#   prepare-fixture.sh <output-dir> <asset-name> <binary-path> <version> [<version> ...]
#
# Creates:
#   <output>/download/v<ver>/<asset>
#   <output>/download/v<ver>/SHA256SUMS
#   <output>/releases/latest.json   (tag_name = highest semver arg)
set -euo pipefail

OUT="${1:?output dir}"
ASSET="${2:?asset name}"
BINARY="${3:?binary path}"
shift 3

if [[ ! -f "$BINARY" ]]; then
  echo "prepare-fixture: binary not found: $BINARY" >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "prepare-fixture: at least one version required" >&2
  exit 1
fi

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

latest="$(printf '%s\n' "$@" | sort -V | tail -1)"
for ver in "$@"; do
  dest="$OUT/download/v$ver"
  mkdir -p "$dest"
  cp "$BINARY" "$dest/$ASSET"
  chmod 0755 "$dest/$ASSET"
  hash="$(sha256_of "$dest/$ASSET")"
  printf '%s  %s\n' "$hash" "$ASSET" >"$dest/SHA256SUMS"
done

mkdir -p "$OUT/releases"
printf '{"tag_name":"v%s","name":"v%s"}\n' "$latest" "$latest" >"$OUT/releases/latest.json"

echo "prepare-fixture: wrote versions ($*) latest=v$latest asset=$ASSET -> $OUT"
