#!/usr/bin/env bash
# Maintainer-only: reproduce a reporter's Kunai startup state from a redacted
# support bundle inside a throwaway Alpine + Bun + mpv container.
#
# NOT a shipped user feature. Do not point end users at this harness.
#
# Privacy: seeds config from redacted bundle settings / enabledProviders only.
# Never copies history, titles, search queries, or user data into the container.
#
# Usage (from repo root):
#   ./apps/cli/test/docker/repro/run-repro.sh path/to/kunai-support-bundle-….json
#   ./apps/cli/test/docker/repro/run-repro.sh ./apps/cli/test/docker/repro/fixtures/sample-support-bundle.json --smoke
#   ./apps/cli/test/docker/repro/run-repro.sh bundle.json --binary ./apps/cli/dist/bin/kunai-linux-x64-musl
#   ./apps/cli/test/docker/repro/run-repro.sh bundle.json --build
#   ./apps/cli/test/docker/repro/run-repro.sh bundle.json -- kunai --help
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
IMAGE="${KUNAI_REPRO_IMAGE:-kunai-repro:local}"
BUNDLE=""
BINARY="$REPO_ROOT/apps/cli/dist/bin/kunai-linux-x64-musl"
BUILD_IMAGE=0
SMOKE=0
KEEP_XDG=0
PASSTHRU=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --binary)
      BINARY="${2:?--binary requires a path}"
      shift 2
      ;;
    --image)
      IMAGE="${2:?--image requires a tag}"
      shift 2
      ;;
    --build)
      BUILD_IMAGE=1
      shift
      ;;
    --smoke)
      SMOKE=1
      shift
      ;;
    --keep-xdg)
      KEEP_XDG=1
      shift
      ;;
    -h | --help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    --)
      shift
      PASSTHRU=("$@")
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
    *)
      if [[ -z "$BUNDLE" ]]; then
        BUNDLE="$1"
        shift
      else
        echo "Unexpected argument: $1" >&2
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$BUNDLE" ]]; then
  echo "Usage: $0 <support-bundle.json> [--smoke] [--build] [--binary path]" >&2
  exit 1
fi

if [[ ! -f "$BUNDLE" ]]; then
  echo "run-repro: bundle not found: $BUNDLE" >&2
  exit 1
fi

BUNDLE="$(cd "$(dirname "$BUNDLE")" && pwd)/$(basename "$BUNDLE")"

if ! command -v docker >/dev/null 2>&1; then
  echo "run-repro: docker is required" >&2
  exit 1
fi

if [[ ! -f "$BINARY" ]]; then
  echo "run-repro: musl binary not found: $BINARY" >&2
  echo "  Build with: bun run build:binaries -- --only linux-x64-musl" >&2
  exit 1
fi

XDG_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/kunai-repro-xdg.XXXXXX")"
cleanup() {
  if [[ "$KEEP_XDG" -eq 0 ]]; then
    rm -rf "$XDG_ROOT"
  else
    echo "run-repro: kept XDG profile at $XDG_ROOT"
  fi
}
trap cleanup EXIT

mkdir -p \
  "$XDG_ROOT/home" \
  "$XDG_ROOT/config" \
  "$XDG_ROOT/data" \
  "$XDG_ROOT/cache" \
  "$XDG_ROOT/tmp"

echo "→ Seeding throwaway XDG config from redacted bundle settings"
"$SCRIPT_DIR/seed-config-from-bundle.sh" "$BUNDLE" "$XDG_ROOT/config"

if [[ "$BUILD_IMAGE" -eq 1 ]] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "→ Building $IMAGE"
  docker build -t "$IMAGE" -f "$SCRIPT_DIR/Dockerfile" "$SCRIPT_DIR"
fi

"$SCRIPT_DIR/assert-image-size.sh" "$IMAGE"

run_container() {
  local -a cmd=("$@")
  docker run --rm -it \
    --user "$(id -u):$(id -g)" \
    -e HOME=/xdg/home \
    -e XDG_CONFIG_HOME=/xdg/config \
    -e XDG_DATA_HOME=/xdg/data \
    -e XDG_CACHE_HOME=/xdg/cache \
    -e TMPDIR=/xdg/tmp \
    -e TERM="${TERM:-xterm-256color}" \
    -v "$XDG_ROOT/home:/xdg/home" \
    -v "$XDG_ROOT/config:/xdg/config" \
    -v "$XDG_ROOT/data:/xdg/data" \
    -v "$XDG_ROOT/cache:/xdg/cache" \
    -v "$XDG_ROOT/tmp:/xdg/tmp" \
    -v "$BINARY:/usr/local/bin/kunai:ro" \
    -v "$BUNDLE:/work/support-bundle.json:ro" \
    -w /work \
    "$IMAGE" \
    -lc "$(printf '%q ' "${cmd[@]}")"
}

if [[ "$SMOKE" -eq 1 ]]; then
  echo "→ Smoke: kunai --version / --help against seeded profile"
  # Non-interactive for CI-friendly smoke.
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e HOME=/xdg/home \
    -e XDG_CONFIG_HOME=/xdg/config \
    -e XDG_DATA_HOME=/xdg/data \
    -e XDG_CACHE_HOME=/xdg/cache \
    -e TMPDIR=/xdg/tmp \
    -v "$XDG_ROOT/home:/xdg/home" \
    -v "$XDG_ROOT/config:/xdg/config:ro" \
    -v "$XDG_ROOT/data:/xdg/data" \
    -v "$XDG_ROOT/cache:/xdg/cache" \
    -v "$XDG_ROOT/tmp:/xdg/tmp" \
    -v "$BINARY:/usr/local/bin/kunai:ro" \
    -v "$BUNDLE:/work/support-bundle.json:ro" \
    -w /work \
    "$IMAGE" \
    -lc 'set -e; kunai --version; kunai --help >/dev/null; echo "seeded config:"; test -f /xdg/config/kunai/config.json && echo OK; echo "bundle mounted:"; test -f /work/support-bundle.json && echo OK'
  echo "run-repro smoke passed."
  exit 0
fi

if [[ ${#PASSTHRU[@]} -gt 0 ]]; then
  run_container "${PASSTHRU[@]}"
else
  echo "→ Interactive shell. Binary: /usr/local/bin/kunai  Bundle: /work/support-bundle.json"
  echo "  Example: kunai --version   or   kunai --offline"
  run_container bash
fi
