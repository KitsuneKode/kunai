#!/usr/bin/env bash
# Install one attested musl archive through production install.sh inside Alpine.
# The fixture deliberately withholds the raw binary, so a successful smoke is
# evidence that the archive path completed without the legacy fallback.
set -euo pipefail

CANDIDATE_DIR="${1:?usage: smoke-preserved-musl-installer.sh <candidate-dir> <version> <asset>}"
VERSION="${2:?usage: smoke-preserved-musl-installer.sh <candidate-dir> <version> <asset>}"
ASSET="${3:?usage: smoke-preserved-musl-installer.sh <candidate-dir> <version> <asset>}"

case "$ASSET" in
kunai-linux-x64-musl | kunai-linux-arm64-musl) ;;
*)
	echo "unsupported musl release asset: $ASSET" >&2
	exit 1
	;;
esac
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
	echo "invalid release version: $VERSION" >&2
	exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
CANDIDATE_DIR="$(cd "$CANDIDATE_DIR" && pwd -P)"
ARCHIVE="${ASSET}.tar.gz"
for file in "$ARCHIVE" SHA256SUMS SHA256SUMS.archives; do
	[[ -f "$CANDIDATE_DIR/$file" ]] || {
		echo "missing preserved release file: $CANDIDATE_DIR/$file" >&2
		exit 1
	}
done

FIXTURE_ROOT="$(mktemp -d)"
cleanup() {
	rm -rf "$FIXTURE_ROOT"
}
trap cleanup EXIT

FIXTURE_VERSION_DIR="$FIXTURE_ROOT/download/v$VERSION"
mkdir -p "$FIXTURE_VERSION_DIR"
cp "$CANDIDATE_DIR/$ARCHIVE" "$FIXTURE_VERSION_DIR/$ARCHIVE"
cp "$CANDIDATE_DIR/SHA256SUMS" "$FIXTURE_VERSION_DIR/SHA256SUMS"
cp "$CANDIDATE_DIR/SHA256SUMS.archives" "$FIXTURE_VERSION_DIR/SHA256SUMS.archives"
test ! -e "$FIXTURE_VERSION_DIR/$ASSET"

EXPECTED_ARCHIVE_SHA="$(sha256sum "$CANDIDATE_DIR/$ARCHIVE" | awk '{print $1}')"
IMAGE="kunai-release-musl-installer:${VERSION}"
docker build \
	--target musl \
	--tag "$IMAGE" \
	--file "$REPO_ROOT/apps/cli/test/docker/native-installer/Dockerfile" \
	"$REPO_ROOT/apps/cli/test/docker/native-installer"

docker run --rm --network none \
	--volume "$FIXTURE_ROOT:/release:ro" \
	--volume "$REPO_ROOT/install.sh:/work/install.sh:ro" \
	--env "KUNAI_EXPECTED_ARCHIVE_SHA=$EXPECTED_ARCHIVE_SHA" \
	--env "KUNAI_RELEASE_ASSET=$ASSET" \
	--env "KUNAI_RELEASE_VERSION=$VERSION" \
	"$IMAGE" \
	bash -ceu '
		profile=/tmp/kunai-release-smoke
		export HOME="$profile/home"
		export KUNAI_BIN_DIR="$profile/bin"
		export KUNAI_CONFIG_DIR="$profile/config"
		export KUNAI_DATA_DIR="$profile/data"
		export KUNAI_CACHE_DIR="$profile/cache"
		export KUNAI_DL_BASE=file:///release
		export KUNAI_SKIP_PATH_UPDATE=1
		mkdir -p "$HOME"

		bash /work/install.sh \
			--method binary \
			--version "$KUNAI_RELEASE_VERSION" \
			--yes \
			--skip-deps \
			--skip-path-update

		manifest="$KUNAI_CONFIG_DIR/install.json"
		test -f "$manifest"
		grep -F "\"activeVersion\": \"$KUNAI_RELEASE_VERSION\"" "$manifest"
		grep -F "\"artifactName\": \"$KUNAI_RELEASE_ASSET\"" "$manifest"
		grep -F "\"archiveName\": \"$KUNAI_RELEASE_ASSET.tar.gz\"" "$manifest"
		grep -F "\"archiveSha256\": \"$KUNAI_EXPECTED_ARCHIVE_SHA\"" "$manifest"
		grep -F "\"archiveSourceUrl\": \"file:///release/download/v$KUNAI_RELEASE_VERSION/$KUNAI_RELEASE_ASSET.tar.gz\"" "$manifest"

		version_output="$("$KUNAI_BIN_DIR/kunai" --version)"
		printf "%s\n" "$version_output"
		printf "%s\n" "$version_output" | grep -E "^kunai[[:space:]]+v?$KUNAI_RELEASE_VERSION([[:space:]]|$)"
		help_output="$("$KUNAI_BIN_DIR/kunai" --help)"
		test -n "$help_output"
		printf "%s\n" "$help_output"
	'
