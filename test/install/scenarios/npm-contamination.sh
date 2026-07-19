#!/usr/bin/env bash
# Scenario: npm global install, then native install over the top.
#
# This is the likeliest real-world breakage. A user installs via npm, later
# installs natively, and ends up with two `kunai` on PATH. Which one wins is
# decided by PATH order, not by which is newer — so the stale npm shim can
# silently shadow the new native build.
#
# Asserts the "only one binary" invariants from
# .plans/plan-0.3.0-release-readiness.md#A2.
set -uo pipefail

FAKE_VERSION="0.3.0"
NPM_VERSION="0.1.0"
FAKE_RELEASE="/opt/fake-release"

failures=0
pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() {
	printf '  \033[31mFAIL\033[0m %s\n' "$1"
	printf '       %s\n' "${2:-}"
	failures=$((failures + 1))
}
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
section "setup: fake release + npm global install"

/harness/make-fake-release.sh "$FAKE_VERSION" "$FAKE_RELEASE" >/dev/null

# A stand-in for a previously published npm build of the same package. npm can
# exit non-zero on warnings alone, so the shim landing on PATH is the real
# success signal — not the exit code.
npm_log="$(npm install -g /harness/stub-npm-package 2>&1)" || true

npm_shim="$(command -v kunai || true)"
if [[ -z "$npm_shim" ]]; then
	printf '%s\n' "$npm_log"
fi
if [[ -z "$npm_shim" ]]; then
	fail "npm install did not put kunai on PATH" "nothing to contaminate; aborting"
	exit 1
fi
printf '  npm shim: %s (reports %s)\n' "$npm_shim" "$(kunai --version 2>/dev/null || echo '?')"

# ---------------------------------------------------------------------------
section "act: native install over the top"

export KUNAI_DL_BASE="file://$FAKE_RELEASE/releases"
export KUNAI_RELEASES_API="file://$FAKE_RELEASE/api/latest.json"
export KUNAI_BIN_DIR="$HOME/.local/bin"
export KUNAI_DATA_DIR="$HOME/.local/share/kunai"
export KUNAI_CONFIG_DIR="$HOME/.config/kunai"

if ! /harness/install.sh --method binary --yes --skip-deps; then
	fail "install.sh --method binary exited non-zero" "see output above"
fi

hash -r 2>/dev/null || true

# ---------------------------------------------------------------------------
section "assert: only one binary owns PATH"

# Walk PATH entries directly: `command -v` reports only the winner, and its
# `-a` form does not exist in bash. Enumerating every hit is the whole point —
# a shadowed second binary is exactly the failure being tested for.
list_kunai_on_path() {
	local dir
	while IFS= read -r -d ':' dir || [[ -n "$dir" ]]; do
		[[ -n "$dir" && -x "$dir/kunai" ]] && printf '%s\n' "$dir/kunai"
	done <<<"$PATH:"
}

mapfile -t on_path < <(list_kunai_on_path)
if [[ "${#on_path[@]}" -eq 1 ]]; then
	pass "exactly one kunai on PATH"
else
	fail "expected exactly 1 kunai on PATH, found ${#on_path[@]}" "$(printf '%s ' "${on_path[@]}")"
fi

resolved="${on_path[0]:-}"
reported="$(kunai --version 2>/dev/null || echo 'unknown')"
if [[ "$reported" == "$FAKE_VERSION" ]]; then
	pass "PATH resolves to the native build ($reported)"
else
	fail "PATH resolves to the wrong build" \
		"expected $FAKE_VERSION, got '$reported' from $resolved"
fi

launcher="$KUNAI_BIN_DIR/kunai"
if [[ -L "$launcher" ]] && [[ "$(readlink -f "$launcher")" == "$KUNAI_DATA_DIR/versions/"* ]]; then
	pass "launcher points into the versioned layout"
else
	fail "launcher is not a symlink into versions/" \
		"$launcher -> $(readlink -f "$launcher" 2>/dev/null || echo 'missing')"
fi

# Assert on functional artifacts, not directory names: `npm uninstall -g`
# legitimately leaves an empty `@kitsunekode/` scope directory behind, which
# owns no executable and shadows nothing. What must be gone is any kunai
# package or binary that could win a PATH lookup.
npm_leftovers="$(find "$HOME/.npm-global" "/usr/local/lib/node_modules" \
	\( -name 'kunai' -o -name 'kunai.js' \) -print 2>/dev/null || true)"
if [[ -z "$npm_leftovers" ]]; then
	pass "no npm kunai package or binary remains"
else
	fail "npm kunai artifacts still present" "$(printf '%s' "$npm_leftovers" | head -3)"
fi

manifest="$KUNAI_CONFIG_DIR/install.json"
if grep -q '"channel": "binary"' "$manifest" 2>/dev/null; then
	pass "manifest records the binary channel"
else
	fail "manifest does not record channel=binary" "$(cat "$manifest" 2>/dev/null || echo 'missing')"
fi

# ---------------------------------------------------------------------------
section "result"
if [[ "$failures" -eq 0 ]]; then
	printf '\033[32mall assertions passed\033[0m\n'
	exit 0
fi
printf '\033[31m%d assertion(s) failed\033[0m\n' "$failures"
exit 1
