#!/usr/bin/env bash
# In-container native installer scenario runner. Uses only paths under $HOME.
#
# Usage: smoke.sh <glibc|musl> [scenario]
# Default scenario: full-lifecycle
set -euo pipefail

VARIANT="${1:?glibc or musl}"
SCENARIO="${2:-full-lifecycle}"
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
  glibc) ASSET="${KUNAI_ASSET:-kunai-linux-x64}" ;;
  musl) ASSET="${KUNAI_ASSET:-kunai-linux-x64-musl}" ;;
  *)
    echo "Unknown variant: $VARIANT" >&2
    exit 1
    ;;
esac

SERVER_PID=""
SERVE_DIR=""

pass() { printf '✓ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

cleanup_server() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi
}

trap cleanup_server EXIT

reset_home() {
  rm -rf "$HOME"
  mkdir -p "$HOME"
  # Restore default layout env for scenarios that do not call apply_layout_env.
  export KUNAI_BIN_DIR="$HOME/.local/bin"
  export KUNAI_CONFIG_DIR="$HOME/.config/kunai"
  export KUNAI_DATA_DIR="$HOME/.local/share/kunai"
  export KUNAI_CACHE_DIR="$HOME/.cache/kunai"
  unset XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME 2>/dev/null || true
}

apply_layout_env() {
  export KUNAI_BIN_DIR="$1"
  export KUNAI_CONFIG_DIR="$2"
  export KUNAI_DATA_DIR="$3"
  export KUNAI_CACHE_DIR="$4"
  export XDG_CONFIG_HOME="$(dirname "$KUNAI_CONFIG_DIR")"
  export XDG_DATA_HOME="$(dirname "$KUNAI_DATA_DIR")"
  export XDG_CACHE_HOME="$(dirname "$KUNAI_CACHE_DIR")"
  mkdir -p "$KUNAI_BIN_DIR" "$KUNAI_CONFIG_DIR" "$KUNAI_DATA_DIR" "$KUNAI_CACHE_DIR"
}

start_fixture_server() {
  local root="${1:-$FIXTURE}"
  SERVE_DIR="$root"
  [[ -d "$root/download/v1.0.0" ]] || fail "fixture missing at $root (run prepare-fixture.sh on the host first)"
  cleanup_server
  (
    cd "$root"
    python3 -m http.server 9876 >/tmp/kunai-mock-server.log 2>&1
  ) &
  SERVER_PID=$!
  local _
  for _ in $(seq 1 30); do
    if curl -fsS "$KUNAI_RELEASES_API" >/dev/null 2>&1; then
      pass "mock release server ready ($root)"
      return 0
    fi
    sleep 0.2
  done
  fail "mock release server did not start (log: $(tail -5 /tmp/kunai-mock-server.log 2>/dev/null || true))"
}

assert_no_operational_residue() {
  local staging="$KUNAI_CACHE_DIR/staging"
  local locks="$KUNAI_DATA_DIR/locks"
  local txns="$KUNAI_DATA_DIR/transactions"
  if [[ -d "$staging" ]]; then
    local leftovers
    leftovers="$(find "$staging" -mindepth 1 -maxdepth 3 2>/dev/null | head -20 || true)"
    [[ -z "$leftovers" ]] || fail "staging residue remains: $leftovers"
  fi
  if [[ -d "$locks" ]]; then
    local lock_leftovers
    lock_leftovers="$(find "$locks" -type f 2>/dev/null | head -20 || true)"
    [[ -z "$lock_leftovers" ]] || fail "lock residue remains: $lock_leftovers"
  fi
  if [[ -d "$txns" ]]; then
    local txn_leftovers
    txn_leftovers="$(find "$txns" -type f 2>/dev/null | head -20 || true)"
    [[ -z "$txn_leftovers" ]] || fail "transaction residue remains: $txn_leftovers"
  fi
  if [[ -d "$KUNAI_BIN_DIR" ]]; then
    local tmp_launchers
    tmp_launchers="$(find "$KUNAI_BIN_DIR" -name 'kunai.tmp.*' -o -name 'kunai.old.*' 2>/dev/null | head -20 || true)"
    # After successful install, .old may be absent; tmp must never remain.
    tmp_launchers="$(find "$KUNAI_BIN_DIR" -name 'kunai.tmp.*' 2>/dev/null | head -20 || true)"
    [[ -z "$tmp_launchers" ]] || fail "temporary launcher residue remains: $tmp_launchers"
  fi
}

assert_schema1_manifest() {
  local version="$1"
  local path="$KUNAI_CONFIG_DIR/install.json"
  [[ -f "$path" ]] || fail "install.json missing"
  grep -qE '"schemaVersion"[[:space:]]*:[[:space:]]*1' "$path" || fail "install.json missing schemaVersion"
  grep -qE '"method"[[:space:]]*:[[:space:]]*"binary"' "$path" || fail "install.json method not binary"
  grep -qE "\"activeVersion\"[[:space:]]*:[[:space:]]*\"${version//./\\.}\"" "$path" ||
    fail "install.json activeVersion not $version"
  grep -qE '"preferredChannel"[[:space:]]*:[[:space:]]*"stable"' "$path" || fail "install.json preferredChannel"
  grep -q '"launcherPath"' "$path" || fail "install.json launcherPath"
  grep -q '"versionedPath"' "$path" || fail "install.json versionedPath"
  grep -q '"managedPaths"' "$path" || fail "install.json managedPaths"
  grep -q '"artifactSha256"' "$path" || fail "install.json artifactSha256"
  grep -q '"target"' "$path" || fail "install.json target"
}

assert_version_layout() {
  local version="$1"
  [[ -L "$KUNAI_BIN_DIR/kunai" ]] || fail "launcher symlink missing"
  [[ -f "$KUNAI_DATA_DIR/versions/$version/kunai" ]] || fail "versioned binary missing for $version"
  [[ -f "$KUNAI_DATA_DIR/versions/$version/version.json" ]] || fail "version.json missing for $version"
  local target
  target="$(readlink -f "$KUNAI_BIN_DIR/kunai")"
  [[ "$target" == *"/versions/$version/kunai" ]] || fail "launcher not pointing at $version ($target)"
  grep -qE "\"version\"[[:space:]]*:[[:space:]]*\"${version//./\\.}\"" \
    "$KUNAI_DATA_DIR/versions/$version/version.json" || fail "version.json version field"
  grep -q "$ASSET" "$KUNAI_DATA_DIR/versions/$version/version.json" ||
    fail "version.json missing asset name $ASSET"
  grep -qi 'checksum\|release-checksum\|sha256\|verification' \
    "$KUNAI_DATA_DIR/versions/$version/version.json" ||
    fail "version.json missing verification/checksum field"
}

install_pinned() {
  local version="${1:-1.0.0}"
  bash "$REPO/install.sh" --method binary --version "$version" --yes --skip-deps
}

seed_user_data() {
  mkdir -p "$KUNAI_DATA_DIR/downloads" "$HOME/external-downloads"
  printf '{"theme":"sakura"}\n' >"$KUNAI_CONFIG_DIR/config.json"
  printf 'history-db\n' >"$KUNAI_DATA_DIR/kunai-data.sqlite"
  printf 'offline\n' >"$KUNAI_DATA_DIR/downloads/ep1.mkv"
  printf 'external\n' >"$HOME/external-downloads/movie.mkv"
  printf 'unrelated\n' >"$HOME/notes.txt"
}

assert_user_data_preserved() {
  [[ -f "$KUNAI_CONFIG_DIR/config.json" ]] || fail "user config.json was removed"
  [[ -f "$KUNAI_DATA_DIR/kunai-data.sqlite" ]] || fail "user history db was removed"
  [[ -f "$KUNAI_DATA_DIR/downloads/ep1.mkv" ]] || fail "user downloads were removed"
  [[ -f "$HOME/external-downloads/movie.mkv" ]] || fail "external download was removed"
  [[ -f "$HOME/notes.txt" ]] || fail "unrelated HOME file was removed"
}

assert_owned_state_removed() {
  [[ ! -e "$KUNAI_BIN_DIR/kunai" ]] || fail "launcher still present"
  [[ ! -d "$KUNAI_DATA_DIR/versions" ]] || fail "versions dir still present"
  [[ ! -d "$KUNAI_CACHE_DIR/staging" ]] || fail "staging dir still present"
  [[ ! -d "$KUNAI_DATA_DIR/transactions" ]] || fail "transactions dir still present"
  [[ ! -d "$KUNAI_DATA_DIR/locks" ]] || fail "locks dir still present"
  [[ ! -f "$KUNAI_CONFIG_DIR/install.json" ]] || fail "install.json still present"
}

# --- scenarios ---

scenario_clean_install() {
  reset_home
  start_fixture_server
  install_pinned 1.0.0
  assert_version_layout 1.0.0
  assert_schema1_manifest 1.0.0
  "$KUNAI_BIN_DIR/kunai" --version >/tmp/kunai-version.txt
  grep -qi '^kunai ' /tmp/kunai-version.txt || fail "kunai --version must print kunai semver"
  assert_no_operational_residue
  pass "clean-install schema-1 ownership state"
}

scenario_checksum_rejection() {
  reset_home
  # Seed an unrelated user file before any install attempt.
  mkdir -p "$HOME"
  printf 'keep-me\n' >"$HOME/preexisting.txt"

  local writable
  writable="$(mktemp -d /tmp/kunai-corrupt-fixture.XXXXXX)"
  cp -a "$FIXTURE/." "$writable/"
  # Corrupt the asset after SHA256SUMS was generated so checksum verification fails.
  printf '\x00corrupt' >>"$writable/download/v1.0.0/$ASSET"
  start_fixture_server "$writable"

  set +e
  local out
  out="$(bash "$REPO/install.sh" --method binary --version 1.0.0 --yes --skip-deps 2>&1)"
  local code=$?
  set -e
  [[ "$code" -ne 0 ]] || fail "install succeeded despite corrupt checksum"
  printf '%s\n' "$out" | grep -qiE 'checksum|sha256|hash|mismatch|verify' ||
    fail "install failure did not mention checksum (output: $out)"

  [[ ! -e "$KUNAI_BIN_DIR/kunai" ]] || fail "launcher created after checksum failure"
  [[ ! -f "$KUNAI_CONFIG_DIR/install.json" ]] || fail "manifest created after checksum failure"
  [[ ! -f "$KUNAI_DATA_DIR/versions/1.0.0/kunai" ]] || fail "version binary created after checksum failure"
  assert_no_operational_residue
  [[ -f "$HOME/preexisting.txt" ]] || fail "preexisting user file was removed"
  pass "checksum-rejection left no activated state"
  rm -rf "$writable"
}

scenario_reinstall_idempotent() {
  reset_home
  start_fixture_server
  install_pinned 1.0.0
  assert_version_layout 1.0.0
  local installed_at target_before
  installed_at="$(grep -oE '"installedAt"[[:space:]]*:[[:space:]]*"[^"]+"' "$KUNAI_CONFIG_DIR/install.json" | head -1)"
  target_before="$(readlink -f "$KUNAI_BIN_DIR/kunai")"
  [[ -n "$installed_at" ]] || fail "installedAt missing after first install"

  install_pinned 1.0.0
  assert_version_layout 1.0.0
  assert_schema1_manifest 1.0.0
  local target_after
  target_after="$(readlink -f "$KUNAI_BIN_DIR/kunai")"
  [[ "$target_after" == "$target_before" ]] || fail "launcher target changed on reinstall"
  grep -qF "$installed_at" "$KUNAI_CONFIG_DIR/install.json" || fail "installedAt changed on reinstall"
  if grep -qE '"previousVersion"' "$KUNAI_CONFIG_DIR/install.json"; then
    fail "previousVersion should be absent on same-version reinstall"
  fi
  local version_dirs
  version_dirs="$(find "$KUNAI_DATA_DIR/versions" -mindepth 1 -maxdepth 1 -type d | wc -l)"
  [[ "$version_dirs" -eq 1 ]] || fail "expected one retained version dir, got $version_dirs"
  assert_no_operational_residue
  pass "reinstall-idempotent preserved layout"
}

scenario_upgrade_rollback() {
  reset_home
  start_fixture_server
  install_pinned 1.0.0
  "$KUNAI_BIN_DIR/kunai" upgrade
  assert_version_layout 1.0.1
  grep -qE '"previousVersion"[[:space:]]*:[[:space:]]*"1\.0\.0"' "$KUNAI_CONFIG_DIR/install.json" ||
    fail "manifest missing previousVersion 1.0.0"
  [[ -f "$KUNAI_DATA_DIR/versions/1.0.0/kunai" ]] || fail "1.0.0 not retained after upgrade"

  "$KUNAI_BIN_DIR/kunai" rollback --list >/tmp/kunai-rollback-list.txt
  grep -qE '"version"[[:space:]]*:[[:space:]]*"1\.0\.0"' /tmp/kunai-rollback-list.txt ||
    fail "rollback --list missing 1.0.0"

  "$KUNAI_BIN_DIR/kunai" rollback --dry-run >/tmp/kunai-rollback-dry.txt
  grep -qi 'dry-run' /tmp/kunai-rollback-dry.txt || fail "rollback --dry-run missing dry-run marker"
  grep -qE '"activeVersion"[[:space:]]*:[[:space:]]*"1\.0\.1"' "$KUNAI_CONFIG_DIR/install.json" ||
    fail "dry-run mutated activeVersion"

  "$KUNAI_BIN_DIR/kunai" rollback
  assert_version_layout 1.0.0
  assert_no_operational_residue

  "$KUNAI_BIN_DIR/kunai" upgrade
  "$KUNAI_BIN_DIR/kunai" rollback --to 1.0.0
  assert_version_layout 1.0.0
  assert_no_operational_residue
  pass "upgrade-rollback paths"
}

scenario_stale_lock_recovery() {
  reset_home
  start_fixture_server
  seed_user_data
  mkdir -p "$KUNAI_CACHE_DIR/staging/1.0.0" "$KUNAI_DATA_DIR/locks" "$KUNAI_DATA_DIR/transactions"
  printf 'partial\n' >"$KUNAI_CACHE_DIR/staging/1.0.0/partial.bin"
  # Dead PID that is never alive on this host.
  printf '{"pid":2147483646,"version":"1.0.0","execPath":"/tmp/dead","acquiredAt":"2020-01-01T00:00:00.000Z"}\n' \
    >"$KUNAI_DATA_DIR/locks/1.0.0.lock"
  printf '{"schemaVersion":1,"id":"abandoned-txn","kind":"install","pid":2147483646,"version":"1.0.0","stagingDir":"%s","startedAt":"2020-01-01T00:00:00.000Z"}\n' \
    "$KUNAI_CACHE_DIR/staging/1.0.0" >"$KUNAI_DATA_DIR/transactions/abandoned-txn.json"

  install_pinned 1.0.0
  assert_version_layout 1.0.0
  assert_schema1_manifest 1.0.0
  assert_no_operational_residue
  assert_user_data_preserved
  pass "stale-lock-recovery completed install"
}

scenario_uninstall_preserves_user_data() {
  reset_home
  start_fixture_server
  install_pinned 1.0.0
  "$KUNAI_BIN_DIR/kunai" upgrade
  seed_user_data
  mkdir -p "$KUNAI_CACHE_DIR/staging/9.9.9" "$KUNAI_DATA_DIR/locks" "$KUNAI_DATA_DIR/transactions"
  printf 'partial\n' >"$KUNAI_CACHE_DIR/staging/9.9.9/partial.bin"
  printf '{"pid":2147483646,"version":"9.9.9","execPath":"/tmp/dead","acquiredAt":"2020-01-01T00:00:00.000Z"}\n' \
    >"$KUNAI_DATA_DIR/locks/9.9.9.lock"
  printf '{"schemaVersion":1,"id":"abandoned-txn","kind":"upgrade","pid":2147483646,"version":"9.9.9","stagingDir":"%s","startedAt":"2020-01-01T00:00:00.000Z"}\n' \
    "$KUNAI_CACHE_DIR/staging/9.9.9" >"$KUNAI_DATA_DIR/transactions/abandoned-txn.json"
  printf 'aside\n' >"$KUNAI_BIN_DIR/kunai.old.1710000000000"

  # Keep a disposable binary so a second uninstall can still execute after the
  # launcher/version store are removed (exit-0 guidance for already-clean state).
  local spare="$HOME/kunai-uninstall-spare"
  cp -a "$(readlink -f "$KUNAI_BIN_DIR/kunai")" "$spare"

  "$KUNAI_BIN_DIR/kunai" uninstall
  assert_owned_state_removed
  [[ ! -e "$KUNAI_BIN_DIR/kunai.old.1710000000000" ]] || fail "launcher aside still present"
  assert_user_data_preserved

  # Second uninstall: clear already-uninstalled or exit 0 with guidance.
  set +e
  "$spare" uninstall >/tmp/kunai-uninstall2.txt 2>&1
  local code=$?
  set -e
  [[ "$code" -eq 0 || "$code" -eq 1 ]] || fail "second uninstall unexpected exit $code"
  assert_user_data_preserved
  pass "uninstall-preserves-user-data"
}

scenario_custom_xdg_layout() {
  reset_home
  local custom_bin="$HOME/custom/bin"
  local custom_config="$HOME/custom/config/kunai"
  local custom_data="$HOME/custom/data/kunai"
  local custom_cache="$HOME/custom/cache/kunai"
  apply_layout_env "$custom_bin" "$custom_config" "$custom_data" "$custom_cache"
  start_fixture_server
  install_pinned 1.0.0
  assert_version_layout 1.0.0
  assert_schema1_manifest 1.0.0
  [[ ! -d "$HOME/.config/kunai" ]] || fail "default ~/.config/kunai was created"
  [[ ! -d "$HOME/.local/share/kunai" ]] || fail "default ~/.local/share/kunai was created"
  [[ ! -d "$HOME/.cache/kunai" ]] || fail "default ~/.cache/kunai was created"
  [[ ! -e "$HOME/.local/bin/kunai" ]] || fail "default ~/.local/bin/kunai was created"
  assert_no_operational_residue

  seed_user_data
  "$KUNAI_BIN_DIR/kunai" uninstall
  assert_owned_state_removed
  assert_user_data_preserved
  pass "custom-xdg-layout"
}

scenario_full_lifecycle() {
  reset_home
  start_fixture_server
  install_pinned 1.0.0
  assert_version_layout 1.0.0
  assert_schema1_manifest 1.0.0
  pass "install.sh created versioned layout (schema-1)"

  "$KUNAI_BIN_DIR/kunai" --version >/tmp/kunai-version.txt
  grep -qi '^kunai ' /tmp/kunai-version.txt || fail "kunai --version must print kunai semver"
  pass "kunai --version: $(head -1 /tmp/kunai-version.txt)"

  if command -v script >/dev/null 2>&1; then
    rm -f /tmp/kunai-setup-nompv.log
    printf '{"onboardingVersion":0,"downloadOnboardingDismissed":false}\n' >"$KUNAI_CONFIG_DIR/config.json"
    script -qec "$KUNAI_BIN_DIR/kunai --setup" /tmp/kunai-setup-nompv.log >/dev/null 2>&1 &
    local setup_pid=$!
    sleep 2.5
    if kill -0 "$setup_pid" 2>/dev/null; then
      kill "$setup_pid" 2>/dev/null || true
      wait "$setup_pid" 2>/dev/null || true
      pass "kunai --setup opens without mpv"
    else
      wait "$setup_pid" 2>/dev/null || true
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

  "$KUNAI_BIN_DIR/kunai" upgrade
  assert_version_layout 1.0.1
  grep -qE '"previousVersion"[[:space:]]*:[[:space:]]*"1\.0\.0"' "$KUNAI_CONFIG_DIR/install.json" ||
    fail "manifest missing previousVersion 1.0.0"
  pass "kunai upgrade moved launcher to v1.0.1"

  "$KUNAI_BIN_DIR/kunai" upgrade --check >/tmp/kunai-check.txt
  pass "kunai upgrade --check ran"

  "$KUNAI_BIN_DIR/kunai" doctor --json >/tmp/kunai-doctor.json
  grep -qE '"schemaVersion"[[:space:]]*:[[:space:]]*1' /tmp/kunai-doctor.json || fail "doctor JSON missing schemaVersion"
  grep -q '"manifest"' /tmp/kunai-doctor.json || fail "doctor JSON missing manifest"
  grep -qE '"activeVersion"[[:space:]]*:[[:space:]]*"1\.0\.1"' "$KUNAI_CONFIG_DIR/install.json" ||
    fail "doctor mutated activeVersion"
  pass "kunai doctor --json"

  "$KUNAI_BIN_DIR/kunai" rollback --list >/tmp/kunai-rollback-list.txt
  grep -qE '"version"[[:space:]]*:[[:space:]]*"1\.0\.0"' /tmp/kunai-rollback-list.txt ||
    fail "rollback --list missing 1.0.0 candidate"
  pass "kunai rollback --list"

  "$KUNAI_BIN_DIR/kunai" rollback --dry-run >/tmp/kunai-rollback-dry.txt
  grep -qi 'dry-run' /tmp/kunai-rollback-dry.txt || fail "rollback --dry-run missing dry-run marker"
  grep -qE '"activeVersion"[[:space:]]*:[[:space:]]*"1\.0\.1"' "$KUNAI_CONFIG_DIR/install.json" ||
    fail "dry-run mutated activeVersion"
  pass "kunai rollback --dry-run"

  "$KUNAI_BIN_DIR/kunai" rollback
  assert_version_layout 1.0.0
  pass "kunai rollback (default) restored v1.0.0"

  "$KUNAI_BIN_DIR/kunai" upgrade
  "$KUNAI_BIN_DIR/kunai" rollback --to 1.0.0
  assert_version_layout 1.0.0
  pass "kunai rollback --to 1.0.0"

  "$KUNAI_BIN_DIR/kunai" upgrade
  grep -qE '"activeVersion"[[:space:]]*:[[:space:]]*"1\.0\.1"' "$KUNAI_CONFIG_DIR/install.json" ||
    fail "re-upgrade to 1.0.1 failed"

  seed_user_data
  mkdir -p "$KUNAI_CACHE_DIR/staging/9.9.9" "$KUNAI_DATA_DIR/locks" "$KUNAI_DATA_DIR/transactions"
  printf 'partial\n' >"$KUNAI_CACHE_DIR/staging/9.9.9/partial.bin"
  printf '{"pid":2147483646,"version":"9.9.9","execPath":"/tmp/dead","acquiredAt":"2020-01-01T00:00:00.000Z"}\n' \
    >"$KUNAI_DATA_DIR/locks/9.9.9.lock"
  printf '{"schemaVersion":1,"id":"abandoned-txn","kind":"upgrade","pid":2147483646,"version":"9.9.9","stagingDir":"%s","startedAt":"2020-01-01T00:00:00.000Z"}\n' \
    "$KUNAI_CACHE_DIR/staging/9.9.9" >"$KUNAI_DATA_DIR/transactions/abandoned-txn.json"
  printf 'aside\n' >"$KUNAI_BIN_DIR/kunai.old.1710000000000"
  pass "seeded user data and owned residue"

  "$KUNAI_BIN_DIR/kunai" uninstall
  assert_owned_state_removed
  [[ ! -e "$KUNAI_BIN_DIR/kunai.old.1710000000000" ]] || fail "launcher aside still present after uninstall"
  assert_user_data_preserved
  pass "kunai uninstall removed owned state and preserved user data"

  [[ "$HOME" == /tmp/kunai-home* ]] || fail "unexpected HOME=$HOME"
  pass "all state confined to $HOME"
}

case "$SCENARIO" in
  full-lifecycle) scenario_full_lifecycle ;;
  clean-install) scenario_clean_install ;;
  checksum-rejection) scenario_checksum_rejection ;;
  reinstall-idempotent) scenario_reinstall_idempotent ;;
  upgrade-rollback) scenario_upgrade_rollback ;;
  stale-lock-recovery) scenario_stale_lock_recovery ;;
  uninstall-preserves-user-data) scenario_uninstall_preserves_user_data ;;
  custom-xdg-layout) scenario_custom_xdg_layout ;;
  *)
    fail "Unknown scenario: $SCENARIO"
    ;;
esac

printf '\nNative installer smoke (%s) passed.\n' "$VARIANT"
printf 'Scenario %s / %s passed.\n' "$SCENARIO" "$VARIANT"
