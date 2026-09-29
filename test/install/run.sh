#!/usr/bin/env bash
# Driver for installer scenarios.
#
# Usage:
#   test/install/run.sh                      # run every scenario
#   test/install/run.sh npm-contamination    # run one
#
# Each scenario runs in a fresh disposable container, so state never leaks
# between runs and never touches the developer's real install.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE="kunai-install-scenarios"

docker build -q -t "$IMAGE" "$HERE" >/dev/null

if [[ $# -gt 0 ]]; then
	scenarios=("$HERE/scenarios/$1.sh")
else
	mapfile -t scenarios < <(find "$HERE/scenarios" -name '*.sh' | sort)
fi

failed=0
for scenario in "${scenarios[@]}"; do
	name="$(basename "$scenario" .sh)"
	printf '\n\033[1m=== scenario: %s ===\033[0m\n' "$name"

	# install.sh is mounted from the repo so scenarios always exercise the
	# working tree, never a copy baked into the image.
	if docker run --rm \
		--network none \
		--tmpfs /tmp/opencode:rw,exec,mode=1777 \
		-v "$REPO_ROOT/install.sh:/harness/install.sh:ro" \
		-v "$REPO_ROOT/install.ps1:/harness/install.ps1:ro" \
		-v "$HERE/focused.mjs:/harness/focused.mjs:ro" \
		-v "$HERE/make-fake-release.sh:/harness/make-fake-release.sh:ro" \
		-v "$HERE/stub-npm-package:/harness/stub-npm-package:ro" \
		-v "$scenario:/harness/scenario.sh:ro" \
		"$IMAGE" -c '
			set -eu
			fixture="$(mktemp -d /tmp/opencode/scenario-XXXXXX)"
			trap '\''rm -rf "$fixture"'\'' EXIT
			export HOME="$fixture/home" USERPROFILE="$fixture/home"
			export XDG_CONFIG_HOME="$fixture/config" XDG_DATA_HOME="$fixture/data" XDG_CACHE_HOME="$fixture/cache"
			export APPDATA="$fixture/appdata" LOCALAPPDATA="$fixture/localappdata"
			export TMPDIR="$fixture/tmp" TMP="$fixture/tmp" TEMP="$fixture/tmp"
			export NPM_CONFIG_PREFIX="$fixture/npm-global"
			mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$APPDATA" "$LOCALAPPDATA" "$TMPDIR" "$NPM_CONFIG_PREFIX"
			export PATH="$NPM_CONFIG_PREFIX/bin:$HOME/.local/bin:$PATH"
			bash /harness/scenario.sh
		'; then
		printf '\033[32m=== %s: passed ===\033[0m\n' "$name"
	else
		printf '\033[31m=== %s: FAILED ===\033[0m\n' "$name"
		failed=$((failed + 1))
	fi
done

if [[ "$failed" -gt 0 ]]; then
	printf '\n\033[31m%d scenario(s) failed\033[0m\n' "$failed"
	exit 1
fi
printf '\n\033[32mall scenarios passed\033[0m\n'
