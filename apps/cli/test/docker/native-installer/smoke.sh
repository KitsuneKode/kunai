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
export KUNAI_CACHE_DIR="$HOME/.cache/kunai"
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
mkdir -p "$KUNAI_BIN_DIR" "$KUNAI_CONFIG_DIR" "$KUNAI_DATA_DIR" "$KUNAI_CACHE_DIR"

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
[[ -f "$KUNAI_DATA_DIR/versions/1.0.0/version.json" ]] || fail "version metadata missing"
grep -qE '"schemaVersion"[[:space:]]*:[[:space:]]*1' "$KUNAI_CONFIG_DIR/install.json" || fail "install.json missing schemaVersion"
grep -qE '"method"[[:space:]]*:[[:space:]]*"binary"' "$KUNAI_CONFIG_DIR/install.json" || fail "install.json method not binary"
grep -qE '"activeVersion"[[:space:]]*:[[:space:]]*"1\.0\.0"' "$KUNAI_CONFIG_DIR/install.json" || fail "install.json activeVersion"
grep -q '"versionedPath"' "$KUNAI_CONFIG_DIR/install.json" || fail "install.json versionedPath"
grep -qE '"preferredChannel"[[:space:]]*:[[:space:]]*"stable"' "$KUNAI_CONFIG_DIR/install.json" || fail "install.json preferredChannel"
pass "install.sh created versioned layout (schema-1)"

"$KUNAI_BIN_DIR/kunai" --version >/tmp/kunai-version.txt
grep -qi '^kunai ' /tmp/kunai-version.txt || fail "kunai --version must print kunai semver, got: $(head -1 /tmp/kunai-version.txt)"
pass "kunai --version: $(head -1 /tmp/kunai-version.txt)"

# --- README quick-start proofs (setup without mpv; fake mpv --version) ---
# Container images intentionally ship without mpv. Prove setup still mounts.
if command -v script >/dev/null 2>&1; then
  rm -f /tmp/kunai-setup-nompv.log
  printf '{"onboardingVersion":0,"downloadOnboardingDismissed":false}\n' >"$KUNAI_CONFIG_DIR/config.json"
  script -qec "$KUNAI_BIN_DIR/kunai --setup" /tmp/kunai-setup-nompv.log >/dev/null 2>&1 &
  SETUP_PID=$!
  sleep 2.5
  if kill -0 "$SETUP_PID" 2>/dev/null; then
    kill "$SETUP_PID" 2>/dev/null || true
    wait "$SETUP_PID" 2>/dev/null || true
    pass "kunai --setup opens without mpv"
  else
    wait "$SETUP_PID" 2>/dev/null || true
    fail "kunai --setup exited before mount without mpv (README quick-start)"
  fi
else
  pass "skip setup-without-mpv PTY check (script not available)"
fi

mkdir -p "$HOME/readme-shims"
cat >"$HOME/readme-shims/mpv" <<'EOF'
#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "mpv 0.37.0-kunai-fake"
  exit 0
fi
exit 0
EOF
chmod 0755 "$HOME/readme-shims/mpv"
PATH="$HOME/readme-shims:$PATH"
export PATH
mpv --version | grep -qi mpv || fail "fake mpv --version failed"
pass "mpv --version (fake shim for README quick-start)"

# --- kunai upgrade -> v1.0.1 ---
"$KUNAI_BIN_DIR/kunai" upgrade
[[ -f "$KUNAI_DATA_DIR/versions/1.0.1/kunai" ]] || fail "upgrade did not install v1.0.1"
grep -qE '"schemaVersion"[[:space:]]*:[[:space:]]*1' "$KUNAI_CONFIG_DIR/install.json" || fail "manifest missing schemaVersion"
grep -qE '"method"[[:space:]]*:[[:space:]]*"binary"' "$KUNAI_CONFIG_DIR/install.json" || fail "manifest method not binary"
grep -qE '"activeVersion"[[:space:]]*:[[:space:]]*"1\.0\.1"' "$KUNAI_CONFIG_DIR/install.json" || fail "manifest not updated to activeVersion 1.0.1"
grep -qE '"previousVersion"[[:space:]]*:[[:space:]]*"1\.0\.0"' "$KUNAI_CONFIG_DIR/install.json" || fail "manifest missing previousVersion 1.0.0"
grep -q '"versionedPath"' "$KUNAI_CONFIG_DIR/install.json" || fail "manifest missing versionedPath"
launcher_target="$(readlink -f "$KUNAI_BIN_DIR/kunai")"
[[ "$launcher_target" == *"/versions/1.0.1/kunai" ]] || fail "launcher not pointing at 1.0.1 ($launcher_target)"
pass "kunai upgrade moved launcher to v1.0.1"

"$KUNAI_BIN_DIR/kunai" upgrade --check >/tmp/kunai-check.txt
pass "kunai upgrade --check ran"

# --- kunai doctor --json (read-only) ---
"$KUNAI_BIN_DIR/kunai" doctor --json >/tmp/kunai-doctor.json
grep -qE '"schemaVersion"[[:space:]]*:[[:space:]]*1' /tmp/kunai-doctor.json || fail "doctor JSON missing schemaVersion"
grep -q '"manifest"' /tmp/kunai-doctor.json || fail "doctor JSON missing manifest"
# Doctor must not mutate install state.
grep -qE '"activeVersion"[[:space:]]*:[[:space:]]*"1\.0\.1"' "$KUNAI_CONFIG_DIR/install.json" || fail "doctor mutated activeVersion"
pass "kunai doctor --json"

# --- kunai rollback list / dry-run / default ---
"$KUNAI_BIN_DIR/kunai" rollback --list >/tmp/kunai-rollback-list.txt
grep -qE '"version"[[:space:]]*:[[:space:]]*"1\.0\.0"' /tmp/kunai-rollback-list.txt ||
  fail "rollback --list missing 1.0.0 candidate"
pass "kunai rollback --list"

"$KUNAI_BIN_DIR/kunai" rollback --dry-run >/tmp/kunai-rollback-dry.txt
grep -qi 'dry-run' /tmp/kunai-rollback-dry.txt || fail "rollback --dry-run missing dry-run marker"
grep -qE '"activeVersion"[[:space:]]*:[[:space:]]*"1\.0\.1"' "$KUNAI_CONFIG_DIR/install.json" || fail "dry-run mutated activeVersion"
pass "kunai rollback --dry-run"

"$KUNAI_BIN_DIR/kunai" rollback
grep -qE '"activeVersion"[[:space:]]*:[[:space:]]*"1\.0\.0"' "$KUNAI_CONFIG_DIR/install.json" || fail "default rollback did not restore 1.0.0"
launcher_target="$(readlink -f "$KUNAI_BIN_DIR/kunai")"
[[ "$launcher_target" == *"/versions/1.0.0/kunai" ]] || fail "launcher not pointing at 1.0.0 after rollback ($launcher_target)"
pass "kunai rollback (default) restored v1.0.0"

# Upgrade again so explicit --to has a non-active target, then roll back explicitly.
"$KUNAI_BIN_DIR/kunai" upgrade
"$KUNAI_BIN_DIR/kunai" rollback --to 1.0.0
grep -qE '"activeVersion"[[:space:]]*:[[:space:]]*"1\.0\.0"' "$KUNAI_CONFIG_DIR/install.json" || fail "explicit rollback --to 1.0.0 failed"
pass "kunai rollback --to 1.0.0"

# Bring install back to latest retained for uninstall coverage.
"$KUNAI_BIN_DIR/kunai" upgrade
grep -qE '"activeVersion"[[:space:]]*:[[:space:]]*"1\.0\.1"' "$KUNAI_CONFIG_DIR/install.json" || fail "re-upgrade to 1.0.1 failed"

# --- Seed user data + owned residue, then uninstall ---
mkdir -p "$KUNAI_CACHE_DIR/staging/9.9.9" "$KUNAI_DATA_DIR/locks" "$KUNAI_DATA_DIR/transactions"
mkdir -p "$KUNAI_DATA_DIR/downloads" "$HOME/external-downloads"
printf '{"theme":"sakura"}\n' >"$KUNAI_CONFIG_DIR/config.json"
printf 'history-db\n' >"$KUNAI_DATA_DIR/kunai-data.sqlite"
printf 'offline\n' >"$KUNAI_DATA_DIR/downloads/ep1.mkv"
printf 'external\n' >"$HOME/external-downloads/movie.mkv"
printf 'partial\n' >"$KUNAI_CACHE_DIR/staging/9.9.9/partial.bin"
printf '{"pid":2147483646,"version":"9.9.9","execPath":"/tmp/dead","acquiredAt":"2020-01-01T00:00:00.000Z"}\n' \
  >"$KUNAI_DATA_DIR/locks/9.9.9.lock"
printf '{"schemaVersion":1,"id":"abandoned-txn","kind":"upgrade","pid":2147483646,"version":"9.9.9","stagingDir":"%s","startedAt":"2020-01-01T00:00:00.000Z"}\n' \
  "$KUNAI_CACHE_DIR/staging/9.9.9" >"$KUNAI_DATA_DIR/transactions/abandoned-txn.json"
printf 'aside\n' >"$KUNAI_BIN_DIR/kunai.old.1710000000000"
pass "seeded user data and owned residue"

"$KUNAI_BIN_DIR/kunai" uninstall
[[ ! -e "$KUNAI_BIN_DIR/kunai" ]] || fail "launcher still present after uninstall"
[[ ! -e "$KUNAI_BIN_DIR/kunai.old.1710000000000" ]] || fail "launcher aside still present after uninstall"
[[ ! -d "$KUNAI_DATA_DIR/versions" ]] || fail "versions dir still present after uninstall"
[[ ! -d "$KUNAI_CACHE_DIR/staging" ]] || fail "staging dir still present after uninstall"
[[ ! -d "$KUNAI_DATA_DIR/transactions" ]] || fail "transactions dir still present after uninstall"
[[ ! -d "$KUNAI_DATA_DIR/locks" ]] || fail "locks dir still present after uninstall"
[[ ! -f "$KUNAI_CONFIG_DIR/install.json" ]] || fail "install.json still present after uninstall"

[[ -f "$KUNAI_CONFIG_DIR/config.json" ]] || fail "user config.json was removed"
[[ -f "$KUNAI_DATA_DIR/kunai-data.sqlite" ]] || fail "user history db was removed"
[[ -f "$KUNAI_DATA_DIR/downloads/ep1.mkv" ]] || fail "user downloads were removed"
[[ -f "$HOME/external-downloads/movie.mkv" ]] || fail "external download was removed"
pass "kunai uninstall removed owned state and preserved user data"

# Config dir may remain (no --purge); ensure we did not touch anything outside HOME.
[[ "$HOME" == /tmp/kunai-home* ]] || fail "unexpected HOME=$HOME"
pass "all state confined to $HOME"

printf '\nNative installer smoke (%s) passed.\n' "$VARIANT"
