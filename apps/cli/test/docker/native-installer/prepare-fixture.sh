#!/usr/bin/env bash
# Build a local mock GitHub Releases tree for installer smoke tests.
#
# Usage:
#   prepare-fixture.sh <output-dir> <asset-name> <binary-path> <version> [<version> ...]
#
# Creates:
#   <output>/download/v<ver>/<asset>
#   <output>/download/v<ver>/<asset>.tar.gz
#   <output>/download/v<ver>/<asset>.tar.zst
#   <output>/download/v<ver>/SHA256SUMS
#   <output>/download/v<ver>/SHA256SUMS.archives
#   <output>/download/v<ver>/SHA256SUMS{,.archives}.sig  (when KUNAI_SMOKE_SIGNING_KEY is set)
#   <output>/releases/latest.json   (tag_name = highest semver arg)
set -euo pipefail

# KUNAI_SMOKE_SIGNING_KEY: PEM path of the throwaway Ed25519 key whose public half
# was built into the smoke binary (KUNAI_SMOKE_RELEASE_KEY_SPKI). A binary with an
# embedded key refuses an unsigned upgrade, so the mock release must sign.
SIGNING_KEY="${KUNAI_SMOKE_SIGNING_KEY:-}"
if [[ -n "$SIGNING_KEY" && ! -f "$SIGNING_KEY" ]]; then
  echo "prepare-fixture: signing key not found: $SIGNING_KEY" >&2
  exit 1
fi

# Signs <dir>/<manifest> for <version> with the statement checksum-signature.ts verifies.
sign_manifest() {
  local dir="$1" name="$2" version="$3" digest statement
  digest="$(sha256sum "$dir/$name" | awk '{print $1}')"
  statement="$(mktemp)"
  printf 'kunai-release-manifest v1\nversion: %s\nfile: %s\nsha256: %s\n' \
    "$version" "$name" "$digest" >"$statement"
  openssl pkeyutl -sign -inkey "$SIGNING_KEY" -rawin -in "$statement" -out "$dir/$name.sig"
  rm -f "$statement"
}

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
ZSTD_ARCHIVE="${BINARY}.tar.zst"
RAW_SUMS="$(dirname "$BINARY")/SHA256SUMS"
ARCHIVE_SUMS="$(dirname "$BINARY")/SHA256SUMS.archives"
for required in "$ARCHIVE" "$ZSTD_ARCHIVE" "$RAW_SUMS" "$ARCHIVE_SUMS"; do
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
  cp "$ZSTD_ARCHIVE" "$dest/$ASSET.tar.zst"
  cp "$RAW_SUMS" "$dest/SHA256SUMS"
  cp "$ARCHIVE_SUMS" "$dest/SHA256SUMS.archives"
  chmod 0755 "$dest/$ASSET"
  if [[ -n "$SIGNING_KEY" ]]; then
    sign_manifest "$dest" SHA256SUMS "$ver"
    sign_manifest "$dest" SHA256SUMS.archives "$ver"
  fi
done

mkdir -p "$OUT/releases"
printf '{"tag_name":"v%s","name":"v%s"}\n' "$latest" "$latest" >"$OUT/releases/latest.json"

echo "prepare-fixture: wrote versions ($*) latest=v$latest asset=$ASSET -> $OUT"
