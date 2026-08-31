# Plan 044: Namespace MAL-derived history keys

> **Drift check (run first):** `git diff --stat ec2e90e6..HEAD -- packages/core/src/title-identity.ts packages/storage/src/repositories/history.ts packages/storage/src/repositories/history-title-aliases.ts packages/storage/src/migrations.ts`
> Mismatch → re-read `resolveCanonicalCatalogTitleId` before writing the migration.

**Goal:** Stop an AniList id and a MyAnimeList id that happen to share a number
from resolving to the same `title_id`.

## Status

- **Priority:** P2
- **Effort:** M
- **Risk:** MED — touches the canonical anime history key and needs a data migration
- **Depends on:** none
- **Category:** correctness
- **Planned at:** `ec2e90e6`, 2026-08-31 (canvas audit A-03)

## Current defect

`resolveCanonicalCatalogTitleId` (`packages/core/src/title-identity.ts:34-36`)
returns a **bare** integer for the anime lane:

```ts
if (kind === "anime") {
  return anilistId ?? malId ?? id;
}
```

AniList and MyAnimeList number their catalogues independently, so AniList 16498
and MAL 16498 are different works that both canonicalize to `"16498"`. Their
history rows share one `title_id`, which merges two unrelated titles in
continue-watching, lists, and stats.

The aliases table is namespaced (`history_title_aliases.alias_ns`); the history
row's own `title_id` is not. That asymmetry is the defect.

## The narrowing that makes this affordable

The audit implies renaming every anime key. It does not need to.

Every other lane already namespaces: `youtube:` (`title-identity.ts:45`) and
`tmdb:` (`:51-58`). Bare-integer _is_ the established AniList encoding and sits in
every existing profile. **MAL is the anomaly**, and it is the rarer of the two —
a MAL id only becomes canonical when no AniList id resolved.

So: keep AniList bare, namespace MAL as `mal:<id>`. The collision disappears
because the two encodings can no longer be equal, and the migration only has to
touch rows whose canonical id came from a MAL fallback rather than every anime
row in the database.

## Tasks

- [ ] Add a failing test in `packages/core/test/` proving AniList 16498 and MAL
      16498 resolve to different canonical ids today.
- [ ] Change the anime branch to `anilistId ?? (malId ? \`mal:${malId}\` : undefined) ?? id`.
      Keep the AniList branch byte-identical — a change there rekeys every
      existing anime row and is not what this plan buys.
- [ ] Audit readers that assume a bare integer:
      `grep -rn 'anilistId\|malId' apps/cli/src packages --include='*.ts'` and
      check `resolveAniListIdentity` (`services/sync/sync-identity.ts`), the
      consolidator, and share-link parsing. **STOP** and report if any reader
      round-trips `title_id` back into a tracker id by parsing it as a number.
- [ ] Write a data migration that rekeys existing bare-MAL history rows to
      `mal:<id>`, moving `history_progress`, `history_title_aliases`, and every
      table holding a `title_id` reference (queue, download jobs, follows,
      lists, offline policies) inside **one** transaction.
- [ ] A row is only a MAL row if it has a `malId` and **no** `anilistId`. A row
      carrying both is already keyed by AniList and must not move.
- [ ] Collision case: if `mal:<id>` already exists, merge rather than fail, and
      reuse `mergeHistoryWatchState`
      (`apps/cli/src/domain/continuation/merge-history-progress.ts`) so the
      migration cannot move a resume position backwards.
- [ ] Add a migration test seeded with: a bare-MAL row, a bare-AniList row with
      the same number, a row with both ids, and a pre-existing `mal:` row to
      force the merge path.

## STOP conditions

- A reader parses `title_id` as an integer to recover a tracker id — resolve
  that first; the namespaced form will silently become `NaN`.
- The migration cannot be made single-transaction across every referencing
  table. A partial rekey leaves dangling references, which is worse than the
  collision this plan fixes.

## Out of scope

Dangling `title_id` references left behind by _consolidation_ — follows, queue,
downloads and lists keeping the pre-merge id. Same tables, different trigger,
and it needs its own plan. Noted in PR #289.
