#!/usr/bin/env bash
# Build a fake release tree that install.sh can consume over file:// URLs.
#
# No HTTP server is needed: curl handles file://, and install.sh takes both the
# download base and the releases API as environment overrides. That keeps
# installer scenarios hermetic with no ports, no network and no daemons.
#
# Usage: make-fake-release.sh <version> <outdir> [real-binary]
set -euo pipefail

VERSION="${1:?usage: make-fake-release.sh <version> <outdir> [real-binary]}"
OUT="${2:?usage: make-fake-release.sh <version> <outdir> [real-binary]}"

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
# An optional third argument supplies a *real* executable to publish as every
# asset instead. A shell stub cannot exercise anything the loader does — macOS
# enforces code signatures only on Mach-O binaries, so the arm64 "unsigned
# binaries are killed" path is invisible to a `#!/bin/sh` file.
REAL_BINARY="${3:-}"

stub="$(mktemp)"
if [[ -n "$REAL_BINARY" ]]; then
	[[ -f "$REAL_BINARY" ]] || {
		echo "no such binary: $REAL_BINARY" >&2
		exit 1
	}
	cp "$REAL_BINARY" "$stub"
else
	cat >"$stub" <<STUB
#!/bin/sh
case "\$1" in
  --version|-v) echo "$VERSION" ;;
  *) echo "kunai native stub $VERSION" ;;
esac
STUB
fi

for asset in "${ASSETS[@]}"; do
	install -m 0755 "$stub" "$DL_DIR/$asset"
done
rm -f "$stub"

# Exercise the current archive-first installer path. Each tarball has exactly
# one root member whose name matches the raw compatibility asset, just like the
# canonical release archives. `ustar` avoids implementation-specific metadata
# entries on both GNU tar and the BSD tar shipped by macOS.
ARCHIVES=()
for asset in "${ASSETS[@]}"; do
	archive="$asset.tar.gz"
	# macOS bsdtar pads compressed archives after the gzip member, which makes
	# strict gzip readers report trailing data. Stream the canonical ustar into
	# gzip instead so the compressed container ends exactly with its footer.
	COPYFILE_DISABLE=1 tar -b 1 --format=ustar -cf - -C "$DL_DIR" "$asset" |
		gzip -n >"$DL_DIR/$archive"
	ARCHIVES+=("$archive")
done

# Two-field format: install.sh selects with `awk '$2==asset {print $1}'`.
# macOS has no `sha256sum` — this harness runs there too, so prefer it when
# present and fall back to BSD `shasum`, whose output format is identical.
(
	cd "$DL_DIR"
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "${ASSETS[@]}" >SHA256SUMS
	else
		shasum -a 256 "${ASSETS[@]}" >SHA256SUMS
	fi
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "${ARCHIVES[@]}" >SHA256SUMS.archives
	else
		shasum -a 256 "${ARCHIVES[@]}" >SHA256SUMS.archives
	fi
)

# A checksum file without its signature is a failed install. The key exists
# only for this fixture; the private half is removed before the tree is served.
# macOS `openssl` is LibreSSL and cannot sign Ed25519. Prefer OpenSSL 3,
# including the Homebrew prefix that is not on PATH, then Node.
sign_release_sums() {
	local dl_dir="$1"
	local pub_out="$2"
	local candidate openssl_bin=""
	for candidate in /opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl openssl; do
		if [[ "$candidate" == openssl ]]; then
			command -v openssl >/dev/null 2>&1 || continue
		elif [[ ! -x "$candidate" ]]; then
			continue
		fi
		if "$candidate" version 2>/dev/null | grep -q '^OpenSSL '; then
			openssl_bin="$candidate"
			break
		fi
	done
	if [[ -n "$openssl_bin" ]]; then
		local sign_key sums
		sign_key="$(mktemp)"
		"$openssl_bin" genpkey -algorithm ED25519 -out "$sign_key"
		"$openssl_bin" pkey -in "$sign_key" -pubout -out "$pub_out"
		for sums in SHA256SUMS SHA256SUMS.archives; do
			"$openssl_bin" pkeyutl -sign -inkey "$sign_key" -rawin -in "$dl_dir/$sums" -out "$dl_dir/$sums.sig"
		done
		rm -f "$sign_key"
		return 0
	fi
	if ! command -v node >/dev/null 2>&1; then
		echo "Ed25519 fixture signing needs OpenSSL 3 or Node. macOS LibreSSL cannot sign it." >&2
		return 1
	fi
	node -e 'const crypto=require("crypto");const fs=require("fs");const {publicKey,privateKey}=crypto.generateKeyPairSync("ed25519");fs.writeFileSync(process.argv[1],publicKey.export({type:"spki",format:"pem"}));for (const sums of process.argv.slice(2)) fs.writeFileSync(sums+".sig",crypto.sign(null,fs.readFileSync(sums),privateKey));' \
		"$pub_out" "$dl_dir/SHA256SUMS" "$dl_dir/SHA256SUMS.archives"
}

sign_release_sums "$DL_DIR" "$OUT/ed25519-public.pem"

cp "$DL_DIR"/* "$PINNED_DIR/"
echo "fake release v$VERSION -> $OUT"
