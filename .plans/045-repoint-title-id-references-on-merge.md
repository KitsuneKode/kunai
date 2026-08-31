# Plan 045: Repoint `title_id` references when consolidation merges a row

> **Drift check (run first):** `git diff --stat ec2e90e6..HEAD -- apps/cli/src/services/history-metadata/HistoryIdentityConsolidator.ts packages/storage/src/repositories/history-title-aliases.ts packages/storage/src/migrations.ts`
> Mismatch → re-read the consolidator's merge branch before writing anything.

**Goal:** A consolidation merge must not orphan the user's follows, lists,
downloads, playlists, or offline policies.

## Status

- **Priority:** P2
- **Effort:** M
- **Risk:** MED — writes across a dozen tables
- **Depends on:** shares its migration surface with
  [044](./044-namespace-mal-history-keys.md); decide whether they land together
- **Category:** correctness
- **Planned at:** `ec2e90e6`, 2026-08-31 (canvas audit A-13, second half)

## Current defect

`runHistoryIdentityConsolidator` rekeys a merged row's `history_progress` entry
and reassigns its `history_title_aliases`. It updates **nothing else**.

`title_id` is stored in **14 tables**:

```
calendar_archive          list_items                release_progress_cache
download_jobs             offline_assets            source_inventory
followed_titles           offline_title_policies    title_provider_health
history_progress          playback_events           user_playlist_items
history_title_aliases     playlist_queue
```

The consolidator touches the two history ones. The other twelve keep pointing at
the pre-merge id.

Reads do not rescue them. `followed-titles.ts:64` is
`SELECT * FROM followed_titles WHERE title_id = ?` — a direct comparison, with no
alias resolution anywhere in that repository (nor in `lists.ts` or
`download-jobs.ts`). So a title the user followed under an opaque id silently
stops matching once its history row is consolidated onto the catalog id.

The canvas report named four tables. It is twelve.

## Determine this first

**Which of the twelve are genuinely user-visible when stale?**

`playback_events`, `release_progress_cache`, `source_inventory` and
`title_provider_health` may be caches or append-only telemetry where a stale id
costs nothing and a rewrite is churn. `followed_titles`, `list_items`,
`user_playlist_items`, `playlist_queue`, `download_jobs`,
`offline_title_policies` and `offline_assets` are user intent and almost
certainly must move.

Do not rewrite all twelve reflexively. Classify each as **repoint**, **leave**,
or **delete**, and record the reason per table — that classification is the
substance of this plan, not the SQL.

## Tasks

- [ ] Add a failing test: follow a title under an opaque id, run the
      consolidator, assert the follow still resolves afterwards.
- [ ] Classify all twelve tables (repoint / leave / delete) with a stated reason
      each. Put the table in the plan, then implement it.
- [ ] Give `HistoryTitleAliasRepository` — or a new seam beside it — one
      `repointTitleId(fromTitleId, toTitleId)` that applies the classification,
      so the list of tables lives in **one** place rather than being open-coded
      at each call site.
- [ ] Call it from the consolidator's merge branch and its retitle branch. The
      retitle branch (`HistoryIdentityConsolidator.ts:110-119`) rekeys a row
      without merging and orphans references exactly the same way — the report
      only noticed the merge path.
- [ ] Run the whole thing inside the consolidator's existing transaction.
- [ ] Collision case: repointing onto a `title_id` that already has a row in a
      table with a unique constraint on it (`followed_titles.title_id` is the
      conflict target at `:50`). Decide per table whether that is a merge or a
      drop, and test it.
- [ ] Backfill: existing profiles already have orphans from every consolidation
      run to date. Decide whether a one-shot repair migration is in scope or is
      its own plan, and say which.

## STOP conditions

- A table's `title_id` turns out to be a foreign key with `ON DELETE CASCADE` —
  repointing and deleting then behave differently and the classification above
  is not sufficient.
- The repoint cannot run inside the consolidator's existing transaction. A
  partial repoint is worse than the orphan it fixes.

## Relationship to 044

Plan 044 needs the same "rewrite `title_id` across every table that holds one"
machinery for its MAL migration. Whoever lands first should build the seam; the
second should use it. Landing them in the wrong order means writing it twice.
