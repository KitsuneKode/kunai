#!/usr/bin/env bash
# The `status-data` branch: where the provider sweep publishes its output.
#
#   status-data-branch.sh checkout <dir>             put the branch in <dir>, creating it on first use
#   status-data-branch.sh publish  <dir> <message>   commit what changed there and push it
#
# Why a branch of its own and not `main`. The sweep writes a file every day, and the
# docs read it. Committing that to `main` meant a bot commit a day on the branch
# everyone works on, `[skip ci]` games to keep it from running CI, and a rebase onto
# a moving `main` that could be refused for any reason. It was refused every day for
# three days ("cannot rebase: You have unstaged changes"), nothing was pushed, and
# the board went on showing results three weeks old as though they were current.
# On its own branch the data has one writer, never conflicts with a PR, and reaches
# the site without a release: the docs fetch it at render.
#
# `<dir>` is a git worktree of the current repository, so the caller's own working
# tree is never touched, and a dirty one cannot get in the way. Its files are exactly
# what is published: `checkout` leaves the existing ones in place so the sweep can
# read yesterday's history from them, and `publish` commits whatever is there.
#
# Environment: STATUS_DATA_BRANCH (default status-data), STATUS_DATA_REMOTE (origin).

set -euo pipefail

branch="${STATUS_DATA_BRANCH:-status-data}"
remote="${STATUS_DATA_REMOTE:-origin}"

usage() {
  echo "usage: $0 checkout <dir> | publish <dir> <message>" >&2
  exit 2
}

[ "$#" -ge 2 ] || usage
command="$1"
dir="$2"

case "$command" in
  checkout)
    if git ls-remote --exit-code --heads "$remote" "$branch" >/dev/null 2>&1; then
      git fetch --no-tags --depth=1 "$remote" "$branch"
      git worktree add --detach "$dir" FETCH_HEAD
    else
      # First run: an orphan branch that holds only the data, none of the code.
      git worktree add --detach "$dir"
      git -C "$dir" checkout --quiet --orphan "$branch"
      git -C "$dir" rm -rf --quiet .
    fi
    ;;

  publish)
    [ "$#" -ge 3 ] || usage
    message="$3"
    git -C "$dir" add -A
    if git -C "$dir" diff --cached --quiet; then
      echo "status-data: nothing to publish"
      exit 0
    fi
    git -C "$dir" commit --quiet -m "$message"

    # One writer at a time (the workflow's concurrency group), so this normally
    # lands first time. A maintainer editing the notices file in the browser while a
    # sweep runs is the one way it can be refused; the two commits touch different
    # files, so rebasing onto theirs is clean.
    for attempt in 1 2 3; do
      if git -C "$dir" push --quiet "$remote" "HEAD:refs/heads/$branch"; then
        echo "status-data: published"
        exit 0
      fi
      echo "status-data: push refused (attempt $attempt); rebasing onto the remote" >&2
      git -C "$dir" fetch --quiet --no-tags "$remote" "$branch"
      git -C "$dir" rebase --quiet FETCH_HEAD
      sleep 2
    done
    echo "status-data: could not publish after 3 attempts" >&2
    exit 1
    ;;

  *)
    usage
    ;;
esac
