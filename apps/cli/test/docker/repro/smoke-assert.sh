#!/usr/bin/env bash
# Host-side smoke for the repro harness without requiring a full interactive shell.
# Validates seed-config privacy + (when docker is available) image size + binary boot.
#
# Usage (from repo root):
#   ./apps/cli/test/docker/repro/smoke-assert.sh
#   ./apps/cli/test/docker/repro/smoke-assert.sh --skip-docker
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
FIXTURE="$SCRIPT_DIR/fixtures/sample-support-bundle.json"
NESTED_TOKEN_FIXTURE="$SCRIPT_DIR/fixtures/nested-token-support-bundle.json"
SKIP_DOCKER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-docker) SKIP_DOCKER=1; shift ;;
    -h | --help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

SEED_HOME="$(mktemp -d "${TMPDIR:-/tmp}/kunai-repro-smoke.XXXXXX")"
cleanup() { rm -rf "$SEED_HOME"; }
trap cleanup EXIT

assert_no_nonempty_secrets() {
  local config="$1"
  # Fail if any secret-like key still holds a non-empty string (nested included).
  if jq -e '
    def secret_key:
      test("(?i)^(token|password|cookie|authorization|secret|api[_-]?key)$")
      or test("(?i)(SessionToken|ClientSecret|AccessToken|RefreshToken)$");
    [.. | objects | to_entries[] | select(.key | secret_key) | .value]
    | map(select(type == "string" and length > 0))
    | length > 0
  ' "$config" >/dev/null; then
    echo "smoke-assert: seeded config leaked a non-empty secret value" >&2
    jq '[.. | objects | to_entries[] | select(.key | test("(?i)token|secret|password")) | {key, value}]' "$config" >&2 || true
    exit 1
  fi
  if grep -Eq '"token"[[:space:]]*:[[:space:]]*"[^"]+"' "$config"; then
    echo "smoke-assert: seeded config leaked a non-empty token string" >&2
    exit 1
  fi
}

echo "→ History rejection"
BAD_BUNDLE="$(mktemp "${TMPDIR:-/tmp}/kunai-repro-bad.XXXXXX.json")"
jq '. + {history: [{title: "Secret Show"}]}' "$FIXTURE" >"$BAD_BUNDLE"
if "$SCRIPT_DIR/seed-config-from-bundle.sh" "$BAD_BUNDLE" "$SEED_HOME/bad-config" 2>/dev/null; then
  echo "smoke-assert: expected history bundle to be rejected" >&2
  rm -f "$BAD_BUNDLE"
  exit 1
fi
rm -f "$BAD_BUNDLE"
echo "→ History rejection OK"

echo "→ Seeding config from fixture"
"$SCRIPT_DIR/seed-config-from-bundle.sh" "$FIXTURE" "$SEED_HOME/config"

CONFIG="$SEED_HOME/config/kunai/config.json"
[[ -f "$CONFIG" ]] || { echo "missing seeded config" >&2; exit 1; }

# Privacy greps against the seeded profile (not the bundle events).
if grep -Eiq 'history|displayTitle|"title"|watchHistory|userData' "$CONFIG"; then
  echo "smoke-assert: seeded config contains forbidden user-data keys" >&2
  exit 1
fi
assert_no_nonempty_secrets "$CONFIG"

# Enabled providers from the fixture must appear.
jq -e '.providerRelay.providers.videasy.enabled == true' "$CONFIG" >/dev/null
jq -e '.providerRelay.providers.allanime.enabled == true' "$CONFIG" >/dev/null
echo "→ Seed privacy + provider map OK"

echo "→ Nested token scrub (settings.providerRelay.providers.*.token)"
NESTED_HOME="$SEED_HOME/nested"
"$SCRIPT_DIR/seed-config-from-bundle.sh" "$NESTED_TOKEN_FIXTURE" "$NESTED_HOME"
NESTED_CONFIG="$NESTED_HOME/kunai/config.json"
assert_no_nonempty_secrets "$NESTED_CONFIG"
# Providers must be {enabled} only — no leftover token/baseUrl keys.
jq -e '
  [.providerRelay.providers | to_entries[] | .value | keys] | flatten | unique
  | . == ["enabled"]
' "$NESTED_CONFIG" >/dev/null
jq -e '.providerRelay.baseUrl == "" and .providerRelay.token == ""' "$NESTED_CONFIG" >/dev/null
jq -e '.providerRelay.providers.videasy.enabled == true' "$NESTED_CONFIG" >/dev/null
jq -e '.providerRelay.providers.allanime.enabled == false' "$NESTED_CONFIG" >/dev/null
# Original secrets must not appear anywhere in the seeded file.
if grep -Fq 'nested-provider-secret-token' "$NESTED_CONFIG" \
  || grep -Fq 'top-level-secret-token' "$NESTED_CONFIG" \
  || grep -Fq 'another-nested-secret' "$NESTED_CONFIG" \
  || grep -Fq 'relay.example.invalid' "$NESTED_CONFIG"; then
  echo "smoke-assert: nested-token fixture secrets survived seeding" >&2
  exit 1
fi
echo "→ Nested token scrub OK"

if [[ "$SKIP_DOCKER" -eq 1 ]]; then
  echo "→ Skipping docker checks (--skip-docker)"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "→ docker unavailable; seed assertions passed. Build the image later to verify size."
  exit 0
fi

IMAGE="kunai-repro:local"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "→ Building $IMAGE"
  docker build -t "$IMAGE" -f "$SCRIPT_DIR/Dockerfile" "$SCRIPT_DIR"
fi

"$SCRIPT_DIR/assert-image-size.sh" "$IMAGE"

MUSL_BIN="$REPO_ROOT/apps/cli/dist/bin/kunai-linux-x64-musl"
if [[ ! -f "$MUSL_BIN" ]]; then
  echo "→ musl binary missing; build with: bun run build:binaries -- --only linux-x64-musl" >&2
  echo "→ Skipping container binary boot smoke"
  exit 0
fi

echo "→ Booting musl binary inside repro container (--version)"
VERSION_OUT="$(
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e HOME=/xdg/home \
    -e XDG_CONFIG_HOME=/xdg/config \
    -e XDG_DATA_HOME=/xdg/data \
    -e XDG_CACHE_HOME=/xdg/cache \
    -v "$SEED_HOME/config:/xdg/config:ro" \
    -v "$MUSL_BIN:/usr/local/bin/kunai:ro" \
    "$IMAGE" \
    -lc 'kunai --version'
)"
echo "$VERSION_OUT" | grep -Eq '[0-9]+\.[0-9]+' || {
  echo "smoke-assert: kunai --version did not print a semver: $VERSION_OUT" >&2
  exit 1
}
echo "→ Container boot OK: $VERSION_OUT"
echo "All repro smoke assertions passed."
