#!/usr/bin/env bash

# Verify a standard SHA256SUMS file with the native tool available on the host.
# macOS ships shasum; Linux release builders normally ship sha256sum.
verify_checksums() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$1"
  elif command -v shasum >/dev/null 2>&1; then
    shasum --algorithm 256 --check "$1"
  else
    echo "✗ SHA-256 verifier unavailable (need sha256sum or shasum)" >&2
    return 1
  fi
}
