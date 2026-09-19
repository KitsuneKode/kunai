#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: open-release-metadata-pr.sh <version>}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid release version' >&2; exit 1; }
[[ "${GITHUB_RUN_ID:?}" =~ ^[0-9]+$ ]] || { echo 'Invalid run id' >&2; exit 1; }
repo="${GITHUB_REPOSITORY:?}"
branch="release/published-v${version}-${GITHUB_RUN_ID}"
artifact=".release/kunai-v${version}.json"

# A retry of the metadata job reuses its existing PR instead of republishing or
# overwriting a reviewer's branch. Publication has already been verified.
existing="$(gh pr list --repo "$repo" --head "$branch" --state all --json url,state --jq '.[0] | if . == null then empty else [.state, .url] | @tsv end')"
if [[ -n "$existing" ]]; then
  if [[ "$existing" == CLOSED$'\t'* ]]; then
    echo "Metadata PR was closed without merging; reopen it for review: $existing" >&2
    exit 1
  fi
  echo "Metadata review already exists: $existing"
  exit 0
fi

if git ls-remote --exit-code --heads origin "$branch" >/dev/null; then
  echo "Reusing pushed metadata branch after an interrupted PR creation."
else
  status=$?
  [[ "$status" == 2 ]] || exit "$status"
  [[ -z "$(git diff --cached --name-only)" ]] || { echo 'Unexpected staged changes' >&2; exit 1; }
  git add -- "$artifact"
  if git diff --cached --quiet; then
    echo 'No release metadata change to review.'
    exit 0
  fi
  git switch -c "$branch"
  git commit -m "chore(release): mark v${version} published"
  git push origin "HEAD:refs/heads/${branch}"
fi

body="$(mktemp)"
trap 'rm -f "$body"' EXIT
cat > "$body" <<EOF
Public release v${version} passed publication verification. This PR records its published status; it does not publish packages or binaries.

Review the narrow metadata diff, approve the bot-created workflow runs if GitHub requests it, and merge only after required checks pass. Do not rerun publication to repair metadata.
EOF
gh pr create --repo "$repo" --base main --head "$branch" \
  --title "chore(release): record v${version} publication" --body-file "$body"
