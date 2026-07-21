#!/usr/bin/env bash
# Host entrypoint: build binaries, prepare a mock release, run glibc + musl smoke in Docker.
# Does not read or write ~/.config/kunai, ~/.local/bin, or any host install paths.
#
# Usage (from repo root):
#   ./apps/cli/test/docker/native-installer/run-local.sh
#   ./apps/cli/test/docker/native-installer/run-local.sh --skip-build
#   ./apps/cli/test/docker/native-installer/run-local.sh --skip-image-build
#   ./apps/cli/test/docker/native-installer/run-local.sh --only glibc
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
DOCKER_DIR="$SCRIPT_DIR"
FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kunai-fixture.XXXXXX")"
ONLY=""
SKIP_BUILD=0
SKIP_IMAGE_BUILD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1; shift ;;
    --skip-image-build) SKIP_IMAGE_BUILD=1; shift ;;
    --only)
      ONLY="${2:?glibc or musl}"
      shift 2
      ;;
    -h | --help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

cleanup() {
  rm -rf "$FIXTURE_DIR"
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for native installer smoke tests" >&2
  exit 1
fi

cd "$REPO_ROOT"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "→ Building linux-x64 + linux-x64-musl binaries..."
  bun run --cwd apps/cli build:binaries -- --only linux-x64 --only linux-x64-musl
fi

GLIBC_BIN="$REPO_ROOT/apps/cli/dist/bin/kunai-linux-x64"
MUSL_BIN="$REPO_ROOT/apps/cli/dist/bin/kunai-linux-x64-musl"
[[ -f "$GLIBC_BIN" ]] || {
  echo "Missing $GLIBC_BIN — run without --skip-build" >&2
  exit 1
}
[[ -f "$MUSL_BIN" ]] || {
  echo "Missing $MUSL_BIN — run without --skip-build" >&2
  exit 1
}

echo "→ Preparing mock release fixture at $FIXTURE_DIR"
"$DOCKER_DIR/prepare-fixture.sh" "$FIXTURE_DIR" kunai-linux-x64 "$GLIBC_BIN" 1.0.0 1.0.1
# Musl asset uses same bytes; separate tree under musl-fixture for musl smoke.
MUSL_FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/kunai-musl-fixture.XXXXXX")"
trap 'rm -rf "$FIXTURE_DIR" "$MUSL_FIXTURE"' EXIT
"$DOCKER_DIR/prepare-fixture.sh" "$MUSL_FIXTURE" kunai-linux-x64-musl "$MUSL_BIN" 1.0.0 1.0.1

echo "→ Building smoke images (cached after first run)..."
if [[ "$SKIP_IMAGE_BUILD" -eq 0 ]]; then
  docker build -q -t kunai-installer-smoke:glibc -f "$DOCKER_DIR/Dockerfile" --target glibc "$DOCKER_DIR"
  docker build -q -t kunai-installer-smoke:musl -f "$DOCKER_DIR/Dockerfile" --target musl "$DOCKER_DIR"
else
  docker image inspect kunai-installer-smoke:glibc >/dev/null
  docker image inspect kunai-installer-smoke:musl >/dev/null
fi

run_variant() {
  local variant="$1"
  local image="$2"
  local fixture="$3"
  local asset="$4"
  echo ""
  echo "════════════════════════════════════════"
  echo "  Smoke: $variant"
  echo "════════════════════════════════════════"
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp/kunai-home \
    -e REPO_ROOT=/repo \
    -e FIXTURE_ROOT=/fixture \
    -e KUNAI_ASSET="$asset" \
    -v "$REPO_ROOT:/repo:ro" \
    -v "$fixture:/fixture:ro" \
    "$image" \
    bash /repo/apps/cli/test/docker/native-installer/smoke.sh "$variant"
}

if [[ -z "$ONLY" || "$ONLY" == "glibc" ]]; then
  run_variant glibc kunai-installer-smoke:glibc "$FIXTURE_DIR" kunai-linux-x64
fi
if [[ -z "$ONLY" || "$ONLY" == "musl" ]]; then
  run_variant musl kunai-installer-smoke:musl "$MUSL_FIXTURE" kunai-linux-x64-musl
fi

echo ""
echo "All requested native installer Docker smokes passed."
