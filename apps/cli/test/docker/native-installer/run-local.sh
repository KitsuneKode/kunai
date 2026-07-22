#!/usr/bin/env bash
# Host entrypoint: build binaries, prepare a mock release, run named Docker scenarios.
# Does not read or write ~/.config/kunai, ~/.local/bin, or any host install paths.
#
# Usage (from repo root):
#   ./apps/cli/test/docker/native-installer/run-local.sh
#   ./apps/cli/test/docker/native-installer/run-local.sh --skip-build
#   ./apps/cli/test/docker/native-installer/run-local.sh --skip-image-build
#   ./apps/cli/test/docker/native-installer/run-local.sh --only glibc
#   ./apps/cli/test/docker/native-installer/run-local.sh --scenario checksum-rejection --only glibc
#   ./apps/cli/test/docker/native-installer/run-local.sh --list-scenarios
#   ./apps/cli/test/docker/native-installer/run-local.sh --list-scenarios --gate pr
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"
DOCKER_DIR="$SCRIPT_DIR"
REGISTRY="$DOCKER_DIR/scenarios.tsv"
FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kunai-fixture.XXXXXX")"
MUSL_FIXTURE=""
ONLY=""
SCENARIO="full-lifecycle"
SKIP_BUILD=0
SKIP_IMAGE_BUILD=0
LIST_SCENARIOS=0
LIST_GATE=""

usage() {
  sed -n '2,14p' "$0"
}

# Prints scenario metadata lines: id<TAB>variants<TAB>gate<TAB>description
read_registry() {
  local line id variants gate desc
  local -A seen=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    IFS=$'\t' read -r id variants gate desc <<<"$line"
    [[ -n "$id" && -n "$variants" && -n "$gate" && -n "$desc" ]] || {
      echo "Invalid registry row: $line" >&2
      exit 1
    }
    [[ "$gate" == "pr" || "$gate" == "nightly" ]] || {
      echo "Unknown gate '$gate' for scenario $id" >&2
      exit 1
    }
    if [[ -n "${seen[$id]:-}" ]]; then
      echo "Duplicate scenario id: $id" >&2
      exit 1
    fi
    seen[$id]=1
    local v
    IFS=',' read -ra vs <<<"$variants"
    for v in "${vs[@]}"; do
      [[ "$v" == "glibc" || "$v" == "musl" ]] || {
        echo "Unknown variant '$v' for scenario $id" >&2
        exit 1
      }
    done
    printf '%s\t%s\t%s\t%s\n' "$id" "$variants" "$gate" "$desc"
  done <"$REGISTRY"
}

scenario_variants() {
  local want="$1"
  local id variants gate desc
  while IFS=$'\t' read -r id variants gate desc; do
    if [[ "$id" == "$want" ]]; then
      printf '%s\n' "$variants"
      return 0
    fi
  done < <(read_registry)
  return 1
}

scenario_exists() {
  scenario_variants "$1" >/dev/null
}

list_scenario_cells() {
  local gate_filter="${1:-}"
  local id variants gate desc v
  while IFS=$'\t' read -r id variants gate desc; do
    if [[ -n "$gate_filter" && "$gate" != "$gate_filter" ]]; then
      continue
    fi
    IFS=',' read -ra vs <<<"$variants"
    for v in "${vs[@]}"; do
      printf '%s\t%s\n' "$id" "$v"
    done
  done < <(read_registry)
}

should_run_variant() {
  local variant="$1"
  case ",${SCENARIO_VARIANTS:-}," in
    *",$variant,"*) ;;
    *) return 1 ;;
  esac
  if [[ -n "$ONLY" && "$ONLY" != "$variant" ]]; then
    return 1
  fi
  return 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1; shift ;;
    --skip-image-build) SKIP_IMAGE_BUILD=1; shift ;;
    --only)
      ONLY="${2:?glibc or musl}"
      shift 2
      ;;
    --scenario)
      SCENARIO="${2:?scenario id}"
      shift 2
      ;;
    --list-scenarios)
      LIST_SCENARIOS=1
      shift
      ;;
    --gate)
      LIST_GATE="${2:?pr or nightly}"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

[[ -f "$REGISTRY" ]] || {
  echo "Missing scenario registry: $REGISTRY" >&2
  exit 1
}

read_registry >/dev/null

if [[ "$LIST_SCENARIOS" -eq 1 ]]; then
  if [[ -n "$LIST_GATE" && "$LIST_GATE" != "pr" && "$LIST_GATE" != "nightly" ]]; then
    echo "--gate must be pr or nightly" >&2
    exit 1
  fi
  list_scenario_cells "$LIST_GATE"
  exit 0
fi

if ! scenario_exists "$SCENARIO"; then
  echo "Unknown scenario: $SCENARIO" >&2
  echo "Known scenarios:" >&2
  list_scenario_cells | cut -f1 | sort -u >&2
  exit 1
fi

SCENARIO_VARIANTS="$(scenario_variants "$SCENARIO")"
if [[ -n "$ONLY" ]]; then
  case ",$SCENARIO_VARIANTS," in
    *",$ONLY,"*) ;;
    *)
      echo "Scenario $SCENARIO does not declare variant $ONLY (has: $SCENARIO_VARIANTS)" >&2
      exit 1
      ;;
  esac
fi

cleanup() {
  rm -rf "$FIXTURE_DIR" "${MUSL_FIXTURE:-}"
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for native installer smoke tests" >&2
  exit 1
fi

cd "$REPO_ROOT"

NEED_GLIBC=0
NEED_MUSL=0
should_run_variant glibc && NEED_GLIBC=1
should_run_variant musl && NEED_MUSL=1

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "→ Building requested binaries..."
  local_only=()
  [[ "$NEED_GLIBC" -eq 1 ]] && local_only+=(--only linux-x64)
  [[ "$NEED_MUSL" -eq 1 ]] && local_only+=(--only linux-x64-musl)
  # Always build both when neither filter applies (safety); should not happen.
  if [[ ${#local_only[@]} -eq 0 ]]; then
    local_only=(--only linux-x64 --only linux-x64-musl)
  fi
  bun run --cwd apps/cli build:binaries -- "${local_only[@]}"
fi

GLIBC_BIN="$REPO_ROOT/apps/cli/dist/bin/kunai-linux-x64"
MUSL_BIN="$REPO_ROOT/apps/cli/dist/bin/kunai-linux-x64-musl"
if [[ "$NEED_GLIBC" -eq 1 && ! -f "$GLIBC_BIN" ]]; then
  echo "Missing $GLIBC_BIN — run without --skip-build" >&2
  exit 1
fi
if [[ "$NEED_MUSL" -eq 1 && ! -f "$MUSL_BIN" ]]; then
  echo "Missing $MUSL_BIN — run without --skip-build" >&2
  exit 1
fi

echo "→ Preparing mock release fixture(s)"
if [[ "$NEED_GLIBC" -eq 1 ]]; then
  "$DOCKER_DIR/prepare-fixture.sh" "$FIXTURE_DIR" kunai-linux-x64 "$GLIBC_BIN" 1.0.0 1.0.1
fi
if [[ "$NEED_MUSL" -eq 1 ]]; then
  MUSL_FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/kunai-musl-fixture.XXXXXX")"
  "$DOCKER_DIR/prepare-fixture.sh" "$MUSL_FIXTURE" kunai-linux-x64-musl "$MUSL_BIN" 1.0.0 1.0.1
fi

echo "→ Building smoke images (cached after first run)..."
if [[ "$SKIP_IMAGE_BUILD" -eq 0 ]]; then
  [[ "$NEED_GLIBC" -eq 1 ]] &&
    docker build -q -t kunai-installer-smoke:glibc -f "$DOCKER_DIR/Dockerfile" --target glibc "$DOCKER_DIR"
  [[ "$NEED_MUSL" -eq 1 ]] &&
    docker build -q -t kunai-installer-smoke:musl -f "$DOCKER_DIR/Dockerfile" --target musl "$DOCKER_DIR"
else
  [[ "$NEED_GLIBC" -eq 1 ]] && docker image inspect kunai-installer-smoke:glibc >/dev/null
  [[ "$NEED_MUSL" -eq 1 ]] && docker image inspect kunai-installer-smoke:musl >/dev/null
fi

run_variant() {
  local variant="$1"
  local image="$2"
  local fixture="$3"
  local asset="$4"
  echo ""
  echo "════════════════════════════════════════"
  echo "  Scenario: $SCENARIO / $variant"
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
    bash /repo/apps/cli/test/docker/native-installer/smoke.sh "$variant" "$SCENARIO"
}

if [[ "$NEED_GLIBC" -eq 1 ]]; then
  run_variant glibc kunai-installer-smoke:glibc "$FIXTURE_DIR" kunai-linux-x64
fi
if [[ "$NEED_MUSL" -eq 1 ]]; then
  run_variant musl kunai-installer-smoke:musl "$MUSL_FIXTURE" kunai-linux-x64-musl
fi

echo ""
echo "All requested native installer Docker scenarios passed."
