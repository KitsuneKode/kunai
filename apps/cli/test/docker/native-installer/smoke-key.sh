#!/usr/bin/env bash
# Mint (if missing) a throwaway Ed25519 key for installer smoke runs and print
# its public half as the base64 SPKI that KUNAI_SMOKE_RELEASE_KEY_SPKI expects.
#
# Usage: smoke-key.sh <pem-path>
#
# The binary is built with the public half embedded and prepare-fixture.sh signs
# the mock release with the private half (KUNAI_SMOKE_SIGNING_KEY), so a smoke
# upgrade runs with signature verification on, exactly like a real one. The key
# signs only fixtures and is never the release key.
set -euo pipefail

PEM="${1:?pem path}"
if [[ ! -s "$PEM" ]]; then
  (umask 077 && openssl genpkey -algorithm ed25519 -out "$PEM")
fi
openssl pkey -in "$PEM" -pubout -outform DER | openssl base64 -A
echo
