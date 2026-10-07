#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_REF_NAME:?GITHUB_REF_NAME must name the checked-out branch}"
target_branch="$GITHUB_REF_NAME"
git check-ref-format "refs/heads/$target_branch"
repo_root="$(git rev-parse --show-toplevel)"
status_path='apps/docs/lib/generated-provider-status.json'
publication_dir="$(mktemp -d "${TMPDIR:-/tmp}/kunai-status-publish.XXXXXX")"
publication_checkout="$publication_dir/checkout"

remove_checkout() {
  if [ -e "$publication_checkout/.git" ]; then
    # This detached checkout belongs solely to this publication attempt.
    git -C "$repo_root" worktree remove --force "$publication_checkout"
  fi
}

trap 'remove_checkout || true; rm -rf "$publication_dir"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Snapshot the trusted producer's output once. Never stage, stash, reset or
# rebase the probe checkout: dependencies and probes may have dirtied it.
cp "$repo_root/$status_path" "$publication_dir/observed-status.json"
jq -e '.schemaVersion == 1 and
  (.providers | type == "array") and
  (.generatedAt | type == "string" and
    test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"))' \
  "$publication_dir/observed-status.json" >/dev/null
observed_at="$(jq -r '.generatedAt' "$publication_dir/observed-status.json")"

for attempt in 1 2 3; do
  echo "provider publication attempt $attempt of 3"
  git -C "$repo_root" fetch --no-tags origin "refs/heads/$target_branch"
  git -C "$repo_root" worktree add --detach "$publication_checkout" FETCH_HEAD

  if [ -f "$publication_checkout/$status_path" ] &&
    jq -e --arg observed_at "$observed_at" \
      '(.generatedAt | type == "string") and (.generatedAt > $observed_at)' \
      "$publication_checkout/$status_path" >/dev/null; then
    echo "a newer provider observation is already published"
    exit 0
  fi

  mkdir -p "$(dirname "$publication_checkout/$status_path")"
  cp "$publication_dir/observed-status.json" "$publication_checkout/$status_path"
  git -C "$publication_checkout" add -- "$status_path"
  if git -C "$publication_checkout" diff --cached --quiet; then
    echo "this provider observation is already published"
    exit 0
  fi

  # A new generatedAt is meaningful freshness evidence even if every status is
  # unchanged. Restrict hooks/identity to this bot commit, not shared config.
  git -C "$publication_checkout" \
    -c core.hooksPath=/dev/null \
    -c user.name='kunai-status-bot[bot]' \
    -c user.email='kunai-status-bot[bot]@users.noreply.github.com' \
    commit -m 'docs(status): refresh provider status sweep [skip ci]'
  if git -C "$publication_checkout" -c core.hooksPath=/dev/null \
    push origin "HEAD:refs/heads/$target_branch"; then
    exit 0
  fi

  # If the branch advanced during the push, repeat from its fresh head. Never
  # replay the stale status over a newer observation or retry a dirty rebase.
  remove_checkout
done

echo 'provider status could not be pushed after three clean publication attempts' >&2
exit 1
