#!/usr/bin/env bash
# Install the public release through production install.sh, the way the README
# tells a user to, and prove the binary it activates reports <version>.
#
# The `installer-smoke` jobs run `needs: candidate` — against artifacts that
# have not been published yet — and the registry smoke in the publish job
# covers only the npm route. Nothing exercised the recommended route against
# the real release, and that route has a step the candidate harness structurally
# cannot reach: install.sh resolves `latest` from
# api.github.com/repos/KitsuneKode/kunai/releases/latest, and that endpoint
# excludes drafts. Until `gh release edit --draft=false --latest` runs, the
# route resolves to the *previous* release. So this must run after promotion,
# and it must let install.sh resolve `latest` itself — pinning `--version`
# would skip the one thing only a post-promote run can prove.
set -euo pipefail

VERSION="${1:?usage: smoke-published-installer.sh <version> [install-script]}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
	echo "::error::invalid release version: $VERSION"
	exit 1
}
TAG="v$VERSION"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
INSTALLER="${2:-$REPO_ROOT/install.sh}"
[[ -f "$INSTALLER" ]] || {
	echo "::error::installer not found: $INSTALLER"
	exit 1
}

RELEASES_API="${KUNAI_RELEASES_API:-https://api.github.com/repos/KitsuneKode/kunai/releases/latest}"

# `gh release edit --draft=false --latest` returns before the REST API has
# caught up, and an unauthenticated api.github.com call can also be rate
# limited on a shared runner IP. Wait for the endpoint to name this tag before
# handing the job to install.sh, so a slow promotion reports itself here
# instead of surfacing as an opaque installer failure that installed the
# previous release.
resolve_latest_tag() {
	curl -fsSL -H "user-agent: kunai-installer" "$RELEASES_API" |
		sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
		head -1
}

observed_tag=""
for attempt in 1 2 3 4 5 6 7 8 9 10; do
	observed_tag="$(resolve_latest_tag || true)"
	[[ "$observed_tag" == "$TAG" ]] && break
	echo "attempt $attempt: releases/latest reports '${observed_tag:-<none>}', waiting for $TAG"
	observed_tag=""
	sleep 15
done
if [[ "$observed_tag" != "$TAG" ]]; then
	echo "::error::$RELEASES_API never reported $TAG — the recommended install route would install the previous release"
	exit 1
fi
echo "releases/latest reports $TAG"

# A full profile sandbox. KUNAI_CONFIG_DIR alone is not isolation: install.sh
# derives DATA_DIR and CACHE_DIR from HOME/XDG independently, so a partial
# override writes a real profile on any machine that has one.
SANDBOX="$(mktemp -d)"
cleanup() {
	rm -rf "$SANDBOX"
}
trap cleanup EXIT

export HOME="$SANDBOX/home"
export XDG_CONFIG_HOME="$SANDBOX/config"
export XDG_DATA_HOME="$SANDBOX/data"
export XDG_CACHE_HOME="$SANDBOX/cache"
export APPDATA="$SANDBOX/appdata"
export KUNAI_BIN_DIR="$SANDBOX/bin"
export KUNAI_SOURCE_DIR="$SANDBOX/src"
# Parity with the musl smoke: nothing here owns a shell rc file worth writing.
export KUNAI_SKIP_PATH_UPDATE=1
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$APPDATA" "$KUNAI_BIN_DIR"

# `--yes --skip-deps` is what makes this non-interactive, and both halves
# matter. `--skip-deps` returns from install_optional_deps before its two mpv
# and yt-dlp prompts; `--yes` short-circuits ask() without touching /dev/tty at
# all. Getting that wrong is not a hang — install.sh's ask() opens /dev/tty and
# declines when the open fails — it is `--yes` alone answering "install mpv?"
# with a silent sudo. `</dev/null` closes the last way stdin could be read.
bash "$INSTALLER" \
	--method binary \
	--yes \
	--skip-deps \
	--skip-path-update </dev/null

MANIFEST="$XDG_CONFIG_HOME/kunai/install.json"
[[ -f "$MANIFEST" ]] || {
	echo "::error::install.sh wrote no ownership manifest at $MANIFEST"
	exit 1
}
grep -F "\"activeVersion\": \"$VERSION\"" "$MANIFEST" || {
	echo "::error::install manifest does not record $VERSION as the active version"
	cat "$MANIFEST"
	exit 1
}

LAUNCHER="$KUNAI_BIN_DIR/kunai"
[[ -x "$LAUNCHER" ]] || {
	echo "::error::no executable launcher at $LAUNCHER after a successful install"
	exit 1
}

OBSERVED="$("$LAUNCHER" --version 2>&1)"
echo "install.sh route reports: $OBSERVED"
case "$OBSERVED" in
*"$VERSION"*) ;;
*)
	echo "::error::install.sh route reported '$OBSERVED', expected $VERSION"
	exit 1
	;;
esac
"$LAUNCHER" --help >/dev/null
echo "published install.sh route verified for $TAG"
