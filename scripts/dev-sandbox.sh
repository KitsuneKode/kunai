#!/usr/bin/env bash
#
# Run Kunai against a throwaway profile, so a manual test cannot touch the real
# one.
#
# KUNAI_CONFIG_DIR selects the sandbox as the dedicated profile root, so config,
# data, cache and credentials all resolve under it. The remaining roots below
# are the same set apps/cli/test/helpers/storage-env.ts uses, deliberately every
# platform's roots at once: XDG_* covers Linux, HOME and
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
# KUNAI_CONFIG_DIR requires an absolute path, so a relative SANDBOX_DIR is
# resolved against the launch directory before any marker checks.
[[ "$SANDBOX" == /* ]] || SANDBOX="$PWD/$SANDBOX"
# A trailing slash must not conceal a symlink from the ownership check.
while [[ "$SANDBOX" != "/" && "$SANDBOX" == */ ]]; do
  SANDBOX="${SANDBOX%/}"
done

# Refuse unrelated paths before any reset. An ownership marker grants this
# script permission to reset only a directory it previously initialized.
MARKER="$SANDBOX/.kunai-dev-sandbox"
MARKER_CONTENT="kunai-dev-sandbox-v1"
managed=0
if [[ -L "$SANDBOX" ]]; then
  echo "refusing: $SANDBOX is a symlink" >&2
  exit 1
fi
if [[ -e "$SANDBOX" ]]; then
  if [[ ! -d "$SANDBOX" || ! -O "$SANDBOX" ]]; then
    echo "refusing: $SANDBOX must be a directory owned by you" >&2
    exit 1
  fi
  if [[ -e "$MARKER" || -L "$MARKER" ]]; then
    marker_value=""
    if [[ -L "$MARKER" || ! -f "$MARKER" || ! -O "$MARKER" ]] ||
      ! IFS= read -r marker_value < "$MARKER" ||
      [[ "$marker_value" != "$MARKER_CONTENT" ]]; then
      echo "refusing: $SANDBOX has an invalid sandbox ownership marker" >&2
      exit 1
    fi
    managed=1
  else
    shopt -s nullglob dotglob
    entries=("$SANDBOX"/*)
    shopt -u nullglob dotglob
    if (( ${#entries[@]} > 0 )); then
      echo "refusing: $SANDBOX is nonempty and is not a managed Kunai sandbox" >&2
      echo "Choose an unused SANDBOX_DIR; existing files were left untouched." >&2
      exit 1
    fi
  fi
fi

if [[ "$managed" == "1" && "${KEEP:-0}" != "1" ]]; then
  rm -rf -- "$SANDBOX"
fi
umask 077
if [[ ! -d "$SANDBOX" ]]; then
  # Atomic create refuses a path another process inserted after validation.
  mkdir -m 700 -- "$SANDBOX"
fi
if [[ -L "$SANDBOX" || ! -O "$SANDBOX" ]]; then
  echo "refusing: sandbox ownership changed during initialization" >&2
  exit 1
fi
chmod 700 "$SANDBOX"
if [[ ! -e "$MARKER" ]]; then
  (set -o noclobber; printf '%s\n' "$MARKER_CONTENT" > "$MARKER")
fi

echo "kunai sandbox → $SANDBOX"
echo "  real profile untouched; delete the directory to reset"
echo

# `env -i` is not used on purpose: the run still needs PATH to find mpv, and
# TERM plus the terminal's own identifying variables to detect graphics support
# at all. Storage, credentials and analytics are isolated explicitly.
exec env \
  DO_NOT_TRACK=1 \
  KUNAI_CREDENTIAL_BACKEND=file \
  KUNAI_CONFIG_DIR="$SANDBOX" \
  HOME="$SANDBOX" \
  USERPROFILE="$SANDBOX" \
  XDG_CONFIG_HOME="$SANDBOX" \
  XDG_DATA_HOME="$SANDBOX" \
  XDG_CACHE_HOME="$SANDBOX" \
  APPDATA="$SANDBOX" \
  LOCALAPPDATA="$SANDBOX" \
  bun "$ROOT/apps/cli/src/main.ts" "$@"
