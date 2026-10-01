#!/usr/bin/env bash
# Build a local mock GitHub Releases tree for installer smoke tests.
#
# Usage:
#   prepare-fixture.sh <output-dir> <asset-name> <binary-path> <version> [<version> ...]
#
# Creates:
#   <output>/download/v<ver>/<asset>
#   <output>/download/v<ver>/<asset>.tar.gz
#   <output>/download/v<ver>/SHA256SUMS
#   <output>/download/v<ver>/SHA256SUMS.sig
#   <output>/download/v<ver>/SHA256SUMS.archives
#   <output>/download/v<ver>/SHA256SUMS.archives.sig
#   <output>/ed25519-public.pem
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

ARCHIVE="${BINARY}.tar.gz"
RAW_SUMS="$(dirname "$BINARY")/SHA256SUMS"
ARCHIVE_SUMS="$(dirname "$BINARY")/SHA256SUMS.archives"
for required in "$ARCHIVE" "$RAW_SUMS" "$ARCHIVE_SUMS"; do
  if [[ ! -f "$required" ]]; then
    echo "prepare-fixture: release companion not found: $required" >&2
    exit 1
  fi
done

latest="$(printf '%s\n' "$@" | sort -V | tail -1)"
for ver in "$@"; do
  dest="$OUT/download/v$ver"
  mkdir -p "$dest"
  cp "$BINARY" "$dest/$ASSET"
  cp "$ARCHIVE" "$dest/$ASSET.tar.gz"
  cp "$RAW_SUMS" "$dest/SHA256SUMS"
  cp "$ARCHIVE_SUMS" "$dest/SHA256SUMS.archives"
  chmod 0755 "$dest/$ASSET"
done

# Sign after the copies so every version directory carries a signature over
# the checksum bytes the installer will verify. The private key never lands
# in the tree the mock server publishes.
sign_key="$(mktemp)"
openssl genpkey -algorithm ED25519 -out "$sign_key"
openssl pkey -in "$sign_key" -pubout -out "$OUT/ed25519-public.pem"
for ver in "$@"; do
  dest="$OUT/download/v$ver"
  openssl pkeyutl -sign -inkey "$sign_key" -rawin -in "$dest/SHA256SUMS" -out "$dest/SHA256SUMS.sig"
  openssl pkeyutl -sign -inkey "$sign_key" -rawin \
    -in "$dest/SHA256SUMS.archives" -out "$dest/SHA256SUMS.archives.sig"
done
rm -f "$sign_key"

mkdir -p "$OUT/releases"
printf '{"tag_name":"v%s","name":"v%s"}\n' "$latest" "$latest" >"$OUT/releases/latest.json"

echo "prepare-fixture: wrote versions ($*) latest=v$latest asset=$ASSET -> $OUT"
