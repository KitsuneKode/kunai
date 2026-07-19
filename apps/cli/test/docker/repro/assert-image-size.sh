#!/usr/bin/env bash
# Assert the kunai-repro Docker image is under the size budget (~200 MB).
#
# Usage:
#   assert-image-size.sh [image-tag]
#   MAX_IMAGE_MB=210 assert-image-size.sh kunai-repro:local
set -euo pipefail

IMAGE="${1:-kunai-repro:local}"
MAX_MB="${MAX_IMAGE_MB:-200}"

if ! command -v docker >/dev/null 2>&1; then
  echo "assert-image-size: docker not available; skip size check" >&2
  echo "  Build later with: docker build -t $IMAGE -f apps/cli/test/docker/repro/Dockerfile apps/cli/test/docker/repro" >&2
  echo "  Then re-run: $0 $IMAGE" >&2
  exit 0
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "assert-image-size: image not found: $IMAGE" >&2
  echo "  Build with: docker build -t $IMAGE -f apps/cli/test/docker/repro/Dockerfile apps/cli/test/docker/repro" >&2
  exit 1
fi

BYTES="$(docker image inspect "$IMAGE" --format '{{.Size}}')"
MB="$(awk -v b="$BYTES" 'BEGIN { printf "%.1f", b / (1024 * 1024) }')"
OK="$(awk -v mb="$MB" -v max="$MAX_MB" 'BEGIN { print (mb + 0 <= max + 0) ? 1 : 0 }')"

echo "assert-image-size: $IMAGE is ${MB} MB (budget ${MAX_MB} MB)"
if [[ "$OK" -ne 1 ]]; then
  echo "assert-image-size: FAIL — image exceeds ~${MAX_MB} MB budget" >&2
  exit 1
fi
echo "assert-image-size: OK"
