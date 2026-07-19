#!/bin/sh

if command -v trmw >/dev/null 2>&1; then
  trmw --profile editor -- apps/cli/dist/bin/kunai-linux-x64 "$@"
else
  apps/cli/dist/bin/kunai-linux-x64 "$@"
fi

exit 0
