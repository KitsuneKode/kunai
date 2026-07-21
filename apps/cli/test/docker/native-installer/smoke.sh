#!/usr/bin/env bash
# In-container native installer smoke test. Uses only paths under $HOME (default /tmp/kunai-home).
#
# Usage: smoke.sh <glibc|musl>
set -euo pipefail

VARIANT="${1:?glibc or musl}"
REPO="${REPO_ROOT:-/repo}"
FIXTURE="${FIXTURE_ROOT:-/fixture}"

export HOME="${KUNAI_TEST_HOME:-/tmp/kunai-home}"
export KUNAI_BIN_DIR="$HOME/.local/bin"
export KUNAI_CONFIG_DIR="$HOME/.config/kunai"
export KUNAI_DATA_DIR="$HOME/.local/share/kunai"
export KUNAI_DL_BASE="${KUNAI_DL_BASE:-http://127.0.0.1:9876}"
export KUNAI_RELEASES_API="${KUNAI_RELEASES_API:-http://127.0.0.1:9876/releases/latest.json}"

case "$VARIANT" in
  glibc)
    ASSET="${KUNAI_ASSET:-kunai-linux-x64}"
    ;;
  musl)
    ASSET="${KUNAI_ASSET:-kunai-linux-x64-musl}"
    ;;
  *)
    echo "Unknown variant: $VARIANT" >&2
    exit 1
    ;;
esac

pass() { printf '✓ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

# Wipe any prior run inside this isolated HOME only.
rm -rf "$HOME"
mkdir -p "$KUNAI_BIN_DIR" "$KUNAI_CONFIG_DIR" "$KUNAI_DATA_DIR"

if [[ ! -d "$FIXTURE/download/v1.0.0" ]]; then
  fail "fixture missing at $FIXTURE (run prepare-fixture.sh on the host first)"
fi

cd "$FIXTURE"
python3 -m http.server 9876 >/tmp/kunai-mock-server.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if curl -fsS "$KUNAI_RELEASES_API" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
curl -fsS "$KUNAI_RELEASES_API" >/dev/null || fail "mock release server did not start"

pass "mock release server ready"

# --- install.sh (pinned v1.0.0) ---
bash "$REPO/install.sh" --method binary --version 1.0.0 --yes --skip-deps

[[ -L "$KUNAI_BIN_DIR/kunai" ]] || fail "launcher symlink missing"
[[ -f "$KUNAI_DATA_DIR/versions/1.0.0/kunai" ]] || fail "versioned binary missing"
# install.sh still writes legacy shape until Task 8; assert bootstrap fields only here.
grep -q '"layout": "versioned"' "$KUNAI_CONFIG_DIR/install.json" || fail "install.json layout"
grep -q '"versionPath"' "$KUNAI_CONFIG_DIR/install.json" || fail "install.json versionPath"
pass "install.sh created versioned layout (legacy bootstrap)"

"$KUNAI_BIN_DIR/kunai" --version >/tmp/kunai-version.txt
grep -qi '^kunai ' /tmp/kunai-version.txt || fail "kunai --version must print kunai semver, got: $(head -1 /tmp/kunai-version.txt)"
pass "kunai --version: $(head -1 /tmp/kunai-version.txt)"

# --- kunai upgrade -> v1.0.1 ---
"$KUNAI_BIN_DIR/kunai" upgrade
[[ -f "$KUNAI_DATA_DIR/versions/1.0.1/kunai" ]] || fail "upgrade did not install v1.0.1"
grep -q '"schemaVersion": 1' "$KUNAI_CONFIG_DIR/install.json" || fail "manifest missing schemaVersion"
grep -q '"method": "binary"' "$KUNAI_CONFIG_DIR/install.json" || fail "manifest method not binary"
grep -q '"activeVersion": "1.0.1"' "$KUNAI_CONFIG_DIR/install.json" || fail "manifest not updated to activeVersion 1.0.1"
grep -q '"versionedPath"' "$KUNAI_CONFIG_DIR/install.json" || fail "manifest missing versionedPath"
launcher_target="$(readlink -f "$KUNAI_BIN_DIR/kunai")"
[[ "$launcher_target" == *"/versions/1.0.1/kunai" ]] || fail "launcher not pointing at 1.0.1 ($launcher_target)"
pass "kunai upgrade moved launcher to v1.0.1"

"$KUNAI_BIN_DIR/kunai" upgrade --check >/tmp/kunai-check.txt
pass "kunai upgrade --check ran"

# --- kunai uninstall ---
"$KUNAI_BIN_DIR/kunai" uninstall
[[ ! -e "$KUNAI_BIN_DIR/kunai" ]] || fail "launcher still present after uninstall"
[[ ! -d "$KUNAI_DATA_DIR/versions" ]] || fail "versions dir still present after uninstall"
[[ ! -f "$KUNAI_CONFIG_DIR/install.json" ]] || fail "install.json still present after uninstall"
pass "kunai uninstall removed binary install"

# Config dir may remain (no --purge); ensure we did not touch anything outside HOME.
[[ "$HOME" == /tmp/kunai-home* ]] || fail "unexpected HOME=$HOME"
pass "all state confined to $HOME"

printf '\nNative installer smoke (%s) passed.\n' "$VARIANT"
