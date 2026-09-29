#!/usr/bin/env bash
set -euo pipefail

# Uses only extracted installer functions; no downloads, builds or user profile.
node /harness/focused.mjs /harness bash powershell
