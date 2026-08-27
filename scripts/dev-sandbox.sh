#!/usr/bin/env bash
#
# Run Kunai against a throwaway profile, so a manual test cannot touch the real
# one.
#
# This exists because the obvious-looking variable is a trap: KUNAI_CONFIG_DIR
# is *not* an override. A run that sets it still resolves the real data and
# cache roots through getKunaiPaths(), reads the developer's live SQLite, and
# can migrate it in place. There is no undo for that.
#
# The full set below is what apps/cli/test/helpers/storage-env.ts uses, and it
# is deliberately every platform's roots at once: XDG_* covers Linux, HOME and
# USERPROFILE cover the homedir() fallbacks macOS resolves through, and
# APPDATA / LOCALAPPDATA cover Windows. Variables that do not apply to the host
# are ignored, so one call is correct everywhere.
#
#   scripts/dev-sandbox.sh                 # fresh profile, interactive shell
#   scripts/dev-sandbox.sh --setup         # the setup wizard
#   scripts/dev-sandbox.sh -S "Dune"       # search on launch
#   KEEP=1 scripts/dev-sandbox.sh          # reuse the last sandbox
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="${SANDBOX_DIR:-${TMPDIR:-/tmp}/kunai-sandbox}"

if [[ "${KEEP:-0}" != "1" ]]; then
  rm -rf "$SANDBOX"
fi
mkdir -p "$SANDBOX"

echo "kunai sandbox → $SANDBOX"
echo "  real profile untouched; delete the directory to reset"
echo

# `env -i` is not used on purpose: the run still needs PATH to find mpv, and
# TERM plus the terminal's own identifying variables to detect graphics support
# at all. Only the storage roots are redirected.
exec env \
  HOME="$SANDBOX" \
  USERPROFILE="$SANDBOX" \
  XDG_CONFIG_HOME="$SANDBOX" \
  XDG_DATA_HOME="$SANDBOX" \
  XDG_CACHE_HOME="$SANDBOX" \
  APPDATA="$SANDBOX" \
  LOCALAPPDATA="$SANDBOX" \
  bun "$ROOT/apps/cli/src/main.ts" "$@"
