#!/usr/bin/env bash
# Scenario: npm global install, then native install over the top.
#
# This is the likeliest real-world breakage. A user installs via npm, later
# installs natively, and ends up with two `kunai` on PATH. Which one wins is
# decided by PATH order, not by which is newer — so the stale npm shim can
# silently shadow the new native build.
#
# Policy under test: the installer reports a conflict rather than removing
# another package manager's global install. So two binaries may legitimately
# remain — what must never happen is the installer printing "Done" while the
# user is silently left on the old build.
set -uo pipefail

FAKE_VERSION="0.3.0"
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

install_log="$(/harness/install.sh --method binary --yes --skip-deps 2>&1)" || {
	printf '%s\n' "$install_log"
	fail "install.sh --method binary exited non-zero" "see output above"
}
printf '%s\n' "$install_log"

hash -r 2>/dev/null || true

# ---------------------------------------------------------------------------
section "assert: install is correct, and any shadowing is reported"

# Walk PATH entries directly: `command -v` reports only the winner, and its
# `-a` form does not exist in bash. Enumerating every hit is the whole point —
# a shadowed second binary is exactly the failure being tested for.
list_kunai_on_path() {
	local dir
	while IFS= read -r -d ':' dir || [[ -n "$dir" ]]; do
		[[ -n "$dir" && -x "$dir/kunai" ]] && printf '%s\n' "$dir/kunai"
	done <<<"$PATH:"
}

# Policy: the installer reports a conflict, it does not remove another package
# manager's global install. So both binaries legitimately remain here. What is
# non-negotiable is that the user is *told* — silently leaving them on an old
# build while printing "Done" is the defect this scenario exists to prevent.
mapfile -t on_path < <(list_kunai_on_path)
printf '  kunai on PATH: %s\n' "$(printf '%s ' "${on_path[@]}")"

launcher="$KUNAI_BIN_DIR/kunai"
winner="$(command -v kunai || true)"

if [[ "$winner" == "$launcher" ]]; then
	pass "native install owns PATH"
elif grep -q "will keep running instead" <<<"$install_log" &&
	grep -qF "$winner" <<<"$install_log"; then
	pass "shadowed install is reported, naming the binary that actually runs"
else
	fail "native install is shadowed and the installer did not say so" \
		"resolves to $winner; installer output never named it"
fi

if [[ "$winner" == "$launcher" ]] || grep -qE 'npm uninstall -g|earlier in your PATH' <<<"$install_log"; then
	pass "remediation is offered"
else
	fail "no remediation offered for the shadowed install" "installer output had no fix instructions"
fi

if grep -q "$FAKE_VERSION" <<<"$("$launcher" --version 2>/dev/null || echo '')"; then
	pass "the installed launcher is the new build ($FAKE_VERSION)"
else
	fail "launcher does not report the installed version" \
		"expected $FAKE_VERSION from $launcher"
fi

if [[ -L "$launcher" ]] && [[ "$(readlink -f "$launcher")" == "$KUNAI_DATA_DIR/versions/"* ]]; then
	pass "launcher points into the versioned layout"
else
	fail "launcher is not a symlink into versions/" \
		"$launcher -> $(readlink -f "$launcher" 2>/dev/null || echo 'missing')"
fi

manifest="$KUNAI_CONFIG_DIR/install.json"
if grep -qE '"method"[[:space:]]*:[[:space:]]*"binary"' "$manifest" 2>/dev/null; then
	pass "manifest records the binary channel"
else
	fail "manifest does not record method=binary" "$(cat "$manifest" 2>/dev/null || echo 'missing')"
fi

# ---------------------------------------------------------------------------
section "result"
if [[ "$failures" -eq 0 ]]; then
	printf '\033[32mall assertions passed\033[0m\n'
	exit 0
fi
printf '\033[31m%d assertion(s) failed\033[0m\n' "$failures"
exit 1
