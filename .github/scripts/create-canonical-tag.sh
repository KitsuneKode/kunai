#!/usr/bin/env bash
# Create and push the canonical release tag, idempotently.
#
# RELEASING.md ("npm publication recovery") tells you to re-dispatch the same
# version after a partial failure. Everything after this step — draft creation,
# draft asset verification, promotion, public verification — is reached only
# once the tag exists, so a failure there is exactly the case that recovery
# path is for. `git tag -a` exits 128 on an existing tag, which made the
# unconditional form fail every such re-dispatch before it could retry
# anything.
#
# Re-creating a tag that already points at the commit being released is a
# no-op, so skip it. A tag pointing anywhere else is a conflict and must stop
# the release: `git tag -f` or a force push would move a tag whose old commit
# is already baked into published checksums, sigstore attestations, and
# `.../releases/download/vX.Y.Z/...` URLs. This script never rewrites a ref.
set -euo pipefail

TAG="${1:?usage: create-canonical-tag.sh <tag> <release-sha>}"
RELEASE_SHA="${2:?usage: create-canonical-tag.sh <tag> <release-sha>}"

[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
	echo "::error::refusing to publish a non-canonical release tag: $TAG"
	exit 1
}
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || {
	echo "::error::refusing to tag a non-canonical commit sha: $RELEASE_SHA"
	exit 1
}

# Peel a ref to the commit it releases. An annotated tag's `refs/tags/X` names
# the tag object, not the commit, so a raw comparison against a release SHA
# never matches; `^{}` (from ls-remote) and `rev-list -n 1` (locally) are the
# two ways to ask for the commit underneath.
remote_tag_commit() {
	local refs peeled
	refs="$(git ls-remote --tags origin "refs/tags/$TAG" "refs/tags/$TAG^{}")"
	peeled="$(awk -v want="refs/tags/$TAG^{}" '$2 == want { print $1 }' <<<"$refs")"
	if [[ -n "$peeled" ]]; then
		printf '%s\n' "$peeled"
		return 0
	fi
	awk -v want="refs/tags/$TAG" '$2 == want { print $1 }' <<<"$refs"
}

# The remote is the authority on whether this release is already tagged. The
# publish job checks out with `fetch-depth: 0`, which does fetch tags, but that
# says what origin looked like when the job started, and a rerun of a job whose
# push already landed is precisely the case this handles.
EXISTING_REMOTE="$(remote_tag_commit)"
if [[ -n "$EXISTING_REMOTE" ]]; then
	if [[ "$EXISTING_REMOTE" == "$RELEASE_SHA" ]]; then
		echo "tag $TAG already exists on origin at $RELEASE_SHA — nothing to do"
		exit 0
	fi
	echo "::error::tag $TAG already exists on origin at $EXISTING_REMOTE, but this run releases $RELEASE_SHA"
	echo "::error::A published release tag is never moved. Investigate which commit v${TAG#v} shipped from; release the fix as the next version."
	exit 1
fi

# Origin has no such tag, so anything local is stale — from an earlier attempt
# in this same checkout, say. Left alone it would fail `git tag -a` with the
# same exit 128 this script exists to remove.
EXISTING_LOCAL="$(git rev-list -n 1 "refs/tags/$TAG" 2>/dev/null || true)"
if [[ -n "$EXISTING_LOCAL" && "$EXISTING_LOCAL" != "$RELEASE_SHA" ]]; then
	echo "::error::local tag $TAG points at $EXISTING_LOCAL, but this run releases $RELEASE_SHA"
	exit 1
fi

# An annotated tag records a tagger, and the runner has no git identity of its
# own, so `git tag -a` aborts with "empty ident name" before it writes
# anything. Same bot identity the metadata job already commits under, kept
# local to this checkout.
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

if [[ -z "$EXISTING_LOCAL" ]]; then
	git tag -a "$TAG" -m "Release $TAG" "$RELEASE_SHA"
fi
git push origin "refs/tags/$TAG"
echo "pushed $TAG at $RELEASE_SHA"
