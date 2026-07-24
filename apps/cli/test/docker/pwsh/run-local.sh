#!/usr/bin/env bash
# Run the PowerShell installer tests locally, in a container that has pwsh.
#
# Usage:
#   bun run test:installer:pwsh              # build (cached) and run the suite
#   bun run test:installer:pwsh -- --shell   # drop into the container instead
#
# The repository is mounted read-write because bun test writes sandboxes under
# the OS temp dir inside the container, not into the mount. node_modules is
# masked with an anonymous volume so the container never consumes (or corrupts)
# the host's platform-specific install.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
IMAGE_TAG="kunai-pwsh-harness:local"
CONTEXT_DIR="${REPO_ROOT}/apps/cli/test/docker/pwsh"

if ! command -v docker >/dev/null 2>&1; then
	echo "[pwsh-harness] docker is required but was not found on PATH." >&2
	exit 1
fi

echo "[pwsh-harness] building ${IMAGE_TAG} (cached after the first run)…"
docker build --tag "${IMAGE_TAG}" "${CONTEXT_DIR}"

if [[ "${1:-}" == "--shell" ]]; then
	exec docker run --rm -it \
		--volume "${REPO_ROOT}:/repo" \
		--volume /repo/node_modules \
		"${IMAGE_TAG}"
fi

echo "[pwsh-harness] running install.ps1 test suite under pwsh…"
exec docker run --rm \
	--volume "${REPO_ROOT}:/repo" \
	--volume /repo/node_modules \
	"${IMAGE_TAG}" \
	-c 'set -euo pipefail
	    pwsh --version
	    cd /repo
	    bun install --frozen-lockfile
	    bun run --cwd apps/cli test:file -- test/integration/install-scripts-pwsh.test.ts'
