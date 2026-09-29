#!/usr/bin/env bash
# Ignored Build Step for the repo's Vercel projects. Exit 1 runs the build,
# exit 0 skips it. Arguments are repo-root-relative paths that should trigger
# a build when they changed since the previous deployment.
#
# Configure per project in Settings → Git → Ignored Build Step:
#
#   # kunai-analytics (root dir apps/analytics-ingest)
#   bash "$(git rev-parse --show-toplevel)/scripts/vercel-ignored-build.sh" \
#     apps/analytics-ingest package.json bun.lock
#
#   # kunai-relay (root dir apps/relay-server)
#   bash "$(git rev-parse --show-toplevel)/scripts/vercel-ignored-build.sh" \
#     apps/relay-server packages/relay packages/providers packages/core \
#     packages/types package.json bun.lock
#
#   # docs (root dir apps/docs) — `docs/` holds the site content, and
#   # `bun run generate` embeds tables read from these apps/cli sources;
#   # extend this list if sync-code-metadata.ts learns new inputs.
#   bash "$(git rev-parse --show-toplevel)/scripts/vercel-ignored-build.sh" \
#     apps/docs docs packages/design packages/types package.json bun.lock \
#     apps/cli/src/cli-args.ts apps/cli/src/container/bootstrap-providers.ts \
#     apps/cli/src/domain/session/command-registry.ts \
#     apps/cli/src/app-shell/keybindings.ts
#
# Keep the dashboard's "Skip deployments when there are no changes" toggle
# disabled for these projects — it short-circuits before this script and does
# not know about out-of-package inputs like `docs/` content.
#
# Diffs against VERCEL_GIT_PREVIOUS_SHA (the last deployed commit), not HEAD^:
# a push of several commits and consecutive skipped builds both accumulate
# correctly. Set FORCE_VERCEL_BUILD=1 as a project env var to bypass the gate
# (manual redeploy of an unchanged commit is otherwise skipped).

set -u

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 1
cd "$root" || exit 1

if [ "${FORCE_VERCEL_BUILD:-}" = "1" ] || [ "$#" -eq 0 ]; then
  echo "vercel-ignored-build: bypass or no watch paths; building"
  exit 1
fi

previous="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$previous" ]; then
  echo "vercel-ignored-build: no previous deployment; building"
  exit 1
fi
if ! git rev-parse --verify --quiet "$previous^{commit}" >/dev/null; then
  previous="HEAD^"
fi

if git diff --quiet "$previous" HEAD -- "$@" 2>/dev/null; then
  echo "vercel-ignored-build: no changes under: $*"
  exit 0
fi

echo "vercel-ignored-build: changes under: $*"
exit 1
