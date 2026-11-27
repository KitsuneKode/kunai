#!/usr/bin/env bash
# Runs Kunai — or, with `--harness <script>`, a test harness — against a
# throwaway profile, so a VHS tape can never read or migrate the developer's
# real config. The recorder shell is not a `bun test` worker: the test preload's
# real-profile guard does not protect it.
#
#   ./test/vhs/isolated-kunai.sh --setup
#   ./test/vhs/isolated-kunai.sh --harness test/harness/ui-demo.ts
#
# `KUNAI_CONFIG_DIR` selects the sandbox as the dedicated profile root, and the
# storage-root set from `test/helpers/storage-env.ts` covers every reader that
# ignores it. PATH is kept as the caller's: its entries are absolute, so moving
# HOME hides nothing, and restating it dropped /opt/homebrew/bin (mpv on Apple
# Silicon). TMPDIR moves inside the sandbox too, so a harness that makes its own
# scratch under `os.tmpdir()` is removed with it.
#
# This also keeps the goldens deterministic: they render an empty profile every
# run instead of whatever happens to be in the developer's config.
set -euo pipefail

SANDBOX_PARENT="${TMPDIR:-/tmp}"
# KUNAI_CONFIG_DIR requires an absolute path; a relative TMPDIR would produce
# a relative sandbox.
[[ "$SANDBOX_PARENT" == /* ]] || SANDBOX_PARENT="$PWD/$SANDBOX_PARENT"

# The EXIT trap below covers a normal exit and HUP/INT/TERM, but VHS tears the
# terminal down hard when a tape ends while the program still runs, and then no
# trap fires. Each sandbox records its owner's PID, so the next launch removes
# any sandbox whose owner is gone. A live owner's sandbox is never touched.
# Two launches can race for the same stale sandbox, so a pid file that vanishes
# between the check and the read is skipped rather than aborting under `set -e`.
for stale in "$SANDBOX_PARENT"/kunai-vhs.*; do
  [[ -d "$stale" ]] || continue
  owner="$(cat "$stale/.owner-pid" 2>/dev/null)" || continue
  [[ "$owner" =~ ^[0-9]+$ ]] || continue
  ps -p "$owner" >/dev/null 2>&1 || rm -rf "$stale"
done

SANDBOX="$(mktemp -d "$SANDBOX_PARENT/kunai-vhs.XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT
echo "$$" > "$SANDBOX/.owner-pid"

BUN_BIN="$(command -v bun)"
BUN_DIR="$(dirname "$BUN_BIN")"
CLI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ "${1:-}" == "--harness" ]]; then
  [[ -n "${2:-}" ]] || { echo "isolated-kunai.sh: --harness needs a script" >&2; exit 2; }
  TARGET="$2"
  shift 2
else
  TARGET="$CLI_ROOT/src/main.ts"
fi

# A fresh profile would otherwise open the setup wizard on every tape
# (`shouldRunSetupWizard` gates on `onboardingVersion < ONBOARDED_FLOOR`), so
# the offline and palette tapes would never reach their surface. `--setup`
# forces the wizard regardless, so setup.tape is unaffected. The value tracks
# ONBOARDING_VERSION in src/app/bootstrap/startup-setup.ts, not the floor:
# seeding the floor would re-open the wizard the moment the floor is raised.
# Analytics stays unset with an empty installId: only an explicit keystroke may
# turn it on, and a tape is not a keystroke. DO_NOT_TRACK backs that up.
# The seed goes where the profile root resolves it on every platform:
# `$KUNAI_CONFIG_DIR/config/config.json`.
mkdir -p "$SANDBOX/config" "$SANDBOX/tmp"
cat > "$SANDBOX/config/config.json" <<'JSON'
{
  "onboardingVersion": 3,
  "analytics": "unset",
  "analyticsNoticeShown": true,
  "installId": "",
  "analyticsEndpoint": "",
  "providerRelay": { "baseUrl": "" }
}
JSON

# NOT `exec`: exec replaces this shell, so the EXIT trap never runs and every
# tape leaves its sandbox behind. Run as a child and let the trap clean up.
env \
  KUNAI_CONFIG_DIR="$SANDBOX" \
  HOME="$SANDBOX" USERPROFILE="$SANDBOX" \
  XDG_CONFIG_HOME="$SANDBOX" XDG_DATA_HOME="$SANDBOX" \
  XDG_CACHE_HOME="$SANDBOX" XDG_STATE_HOME="$SANDBOX" \
  APPDATA="$SANDBOX" LOCALAPPDATA="$SANDBOX" \
  TMPDIR="$SANDBOX/tmp" \
  DO_NOT_TRACK=1 KUNAI_CREDENTIAL_BACKEND=file \
  PATH="$BUN_DIR:$PATH" \
  "$BUN_BIN" "$TARGET" "$@"
