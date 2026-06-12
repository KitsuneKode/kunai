#!/usr/bin/env bash
# Kunai uninstaller. Delegates to the channel-aware `kunai --uninstall` when the
# binary is on PATH; otherwise removes the default binary location directly.
#
# Usage:
#   ./uninstall.sh            # remove kunai, keep user data
#   ./uninstall.sh --purge    # also remove config/history/cache
set -euo pipefail

BIN_DIR="${KUNAI_BIN_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${KUNAI_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kunai}"

if command -v kunai >/dev/null 2>&1; then
  exec kunai --uninstall "$@"
fi

rm -f "$BIN_DIR/kunai" && echo "→ Removed $BIN_DIR/kunai"
if [[ "${1:-}" == "--purge" ]]; then
  rm -rf "$CONFIG_DIR"
  echo "→ Removed $CONFIG_DIR"
else
  echo "→ Config/data left in place: $CONFIG_DIR (use --purge to remove)"
fi
