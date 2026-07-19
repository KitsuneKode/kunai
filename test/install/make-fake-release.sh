#!/usr/bin/env bash
# Build a fake release tree that install.sh can consume over file:// URLs.
#
# No HTTP server is needed: curl handles file://, and install.sh takes both the
# download base and the releases API as environment overrides. That keeps
# installer scenarios hermetic with no ports, no network and no daemons.
#
# Usage: make-fake-release.sh <version> <outdir>
set -euo pipefail

VERSION="${1:?usage: make-fake-release.sh <version> <outdir>}"
OUT="${2:?usage: make-fake-release.sh <version> <outdir>}"

# Every asset name install.sh may request, per its os/arch/libc detection.
ASSETS=(
	kunai-linux-x64
	kunai-linux-arm64
	kunai-linux-x64-musl
	kunai-linux-arm64-musl
	kunai-darwin-x64
	kunai-darwin-arm64
)

DL_DIR="$OUT/releases/latest/download"
PINNED_DIR="$OUT/releases/download/v$VERSION"
mkdir -p "$DL_DIR" "$PINNED_DIR" "$OUT/api"

# The releases API only needs to carry a tag_name; install.sh seds it out.
printf '{"tag_name": "v%s"}\n' "$VERSION" >"$OUT/api/latest.json"

# Stand-in for the real binary. Scenarios assert *which build owns PATH*, so it
# only has to report a version. This proves install mechanics, not that a real
# Kunai build runs — that is the E2E playback harness's job (#30).
stub="$(mktemp)"
cat >"$stub" <<STUB
#!/bin/sh
case "\$1" in
  --version|-v) echo "$VERSION" ;;
  *) echo "kunai native stub $VERSION" ;;
esac
STUB

for asset in "${ASSETS[@]}"; do
	install -m 0755 "$stub" "$DL_DIR/$asset"
done
rm -f "$stub"

# Two-field format: install.sh selects with `awk '$2==asset {print $1}'`.
(
	cd "$DL_DIR"
	sha256sum "${ASSETS[@]}" >SHA256SUMS
)

cp "$DL_DIR"/* "$PINNED_DIR/"
echo "fake release v$VERSION -> $OUT"
