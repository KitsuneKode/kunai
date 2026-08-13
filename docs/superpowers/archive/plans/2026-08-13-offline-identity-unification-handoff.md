# Offline Identity Unification — Handoff

**Written 2026-08-13.** Start a fresh session from this file. It carries the
full state; nothing earlier is required.

## Where things stand

`main` is `2cd0ee88` — PR #32 merged, CI 24/24 SUCCESS. Five PRs merged today:
#26 (AniDB + release truth), #27 (mid-playback recovery), #28 (media
presentation + calendar), #30 (sponsor), #32 (offline playback hardening).
Local `main` synced 0/0.

PR #32 fixed the user-visible breakage. This document is about the invariant
underneath it, which is still missing.

## The problem, stated once

**One title has three id forms, and each subsystem picks a different one.**

| Form            | Example              | Who writes it                                                 |
| --------------- | -------------------- | ------------------------------------------------------------- |
| Provider-native | `allanime-native-id` | provider search results                                       |
| Raw catalog     | `1339713`            | `download_jobs.title_id`, `offline_assets.title_id`           |
| Canonical       | `tmdb:1339713`       | `resolveCanonicalCatalogTitleId`, every history/playback read |

`offline_assets.title_id` is written verbatim from `job.titleId`
(`OfflineAssetService.adoptCompletedJob` → `originJobId: job.id`,
`titleId: job.titleId`). Every playback read canonicalises first. So the moment
a title arrived carrying `externalIds.tmdbId`, the lookup asked for
`tmdb:1339713`, no asset row holds that, and a healthy 13 GB download reported
**"Downloaded file unavailable"**.

Reproduce the divergence in isolation:

```ts
resolveHistoryLookupTitleId({ id: "1339713", kind: "movie" });
// → "1339713"
resolveHistoryLookupTitleId({ id: "1339713", kind: "movie", externalIds: { tmdbId: "1339713" } });
// → "tmdb:1339713"   ← same title, different key
```

### What PR #32 did about it

A **candidate list**, not a fix: `offlineAssetTitleIdCandidates(title, mode)` in
`apps/cli/src/services/offline/offline-episode-index.ts` returns
`[canonical, raw]` and the three offline read sites query both.

- `episode-playback-source.ts` — `findReadyJobIdForEpisode`
- `PlaybackPhase.ts` — `findNextReadyEpisode` (autoplay cursor)
- `playback-mount-shell.tsx` — `isEpisodeDownloaded` (`/play-local` hint)

It is correct, needs no migration, and is deliberately **one function with three
call sites** so the replacement is contained. Do not build more on top of it.

## The infrastructure already exists — this is adoption, not invention

History solved this in the catalog-identity-parity work (landed 2026-07-16).
Offline never adopted it.

`packages/storage/src/repositories/history-title-aliases.ts`:

```
history_title_aliases (alias_ns, alias_id) PRIMARY KEY → title_id
  upsertAliases(canonicalId, aliases)
  lookupTitleId(ns, id)          lookupTitleIdByAliasId(id)
  listByTitleId(titleId)         reassignTitleId(oldId, newId)
```

`HistoryTitleAliasNs` already includes `provider:${string}`, so an opaque
provider-native id is a first-class alias — exactly the third form above.

Already wired: `container.historyTitleAliases`
(`bootstrap-persistence.ts:203,328`). Already written on every history upsert
(`history.ts:180`) and by `HistoryIdentityConsolidator` (`:92,116,143`).

**The gap is that downloads never participate.**

## The two changes

### 1. Persist real external ids on the download job

`download_jobs` has **no external-ids column** (verified against the live
schema). So `DownloadService` fabricates them at
`DownloadService.ts:1532`, `externalIdsFromDownloadJob`:

```ts
if (job.mode === "anime" || job.mediaKind === "anime") {
  const anilistId = titleId.replace(/^anilist:/, "");
  return /^\d+$/.test(anilistId) ? { anilistId } : undefined; // ← MAL id becomes an AniList id
}
```

A MAL-only anime yields `{ anilistId: <malId> }` — a wrong id asserted
confidently, consumed on every re-resolve, able to steer the provider to the
wrong title. This is the deeper half of the bug and must be fixed at **enqueue**,
where the real `externalIds` are still in hand.

- Add an `external_ids_json` column (migration, `data` database).
- Carry `externalIds` through the enqueue path into the row.
- Delete `externalIdsFromDownloadJob` and read the column instead.
- On completion, `upsertAliases(canonicalId, externalIdsToAliases(externalIds))`
  so the download registers its own identity — including a
  `provider:<id>` alias for the provider-native form.

### 2. Resolve offline lookups through the alias index

Replace `offlineAssetTitleIdCandidates` with a single resolution that answers
the canonical id for any input form, via `lookupTitleIdByAliasId`. Then:

- `findReadyJobIdForEpisode`, `findNextReadyEpisode`, `isEpisodeDownloaded`
  take one id again, and `OfflineTitleIdQuery` / `assetsFor` go away.
- Write asset rows under the canonical id in `adoptCompletedJob`.
- Backfill: for each existing asset, resolve its raw `title_id` through the
  alias index and `reassignTitleId` where they differ. Rows whose id resolves to
  nothing stay as they are — they are already reachable under the raw form.

Keep the candidate list until the backfill is proven, then delete it in the same
PR that proves it. Do not leave both.

## Guard rails

`apps/cli/test/integration/offline-local-playback-resolution.test.ts` (added in
#32) is the safety net: real SQLite rows, a real file on disk, the real
selection engine, no provider and no network. Six cases — the reported movie, an
episode, both directions of the source-preference rule, a deleted artifact, and
the external-ids case that reproduced the bug.

**It must stay green through the whole refactor.** It went red for the right
reason before the fix, so it has teeth.

Add before starting: a case where the asset is filed under the raw id and the
title arrives with external ids **and** a `provider:` alias — that is the case
the alias index is supposed to make work and the candidate list cannot.

Also update `apps/cli/test/unit/app/playback/episode-playback-source.test.ts`
("matches downloaded assets by the canonical title id"). It stubs both
`listTitleAssets` and `listByTitleIds`; once lookups take a single id again it
should assert the canonical id is the _only_ one requested.

## Deliberately not in this work

- **Artifact-state tiering.** `ready` conflates _file present_ / _file playable_
  / _metadata complete_, and `resolveOfflineArtifactStatus` only checks
  `size > 0`, so a truncated file is advertised as ready forever. Real debt,
  schema-shaped, **post-release** — nothing user-visible depends on it now that
  repair works.
- **`PlaybackPhase.ts` decomposition** (4,273 lines, `execute()` at 2,866). None
  of the offline failures came from it. The playback-metadata port
  recommendation stands in `2026-08-13-offline-playback-handoff.md`.
- **Timing repair.** `repairArtifactMetadata` restores duration and size because
  those are locally derivable by ffprobe. Intro/outro timing comes from
  IntroDB/AniSkip over the network and cannot be repaired from the file — the
  "timing missing" label persists until the title is re-enriched online. That is
  a boundary, not an oversight.

## Method

One branch off `main`. superpowers:executing-plans for the loop,
superpowers:test-driven-development per task (failing test first),
superpowers:verification-before-completion before any claim. Commit at each
plan commit point.

Gates, from the worktree root:

```sh
bun run typecheck && bun run lint && bun run fmt:check && bun run test && bun run build && git diff --check
```

**Use `bun run fmt:check`, never `bun run fmt`.** `fmt` _writes_ and always
exits 0 — that substitution is why PR #32 reported green locally while CI's
Format check was red. Use `bun run test`, never bare `bun test`.

Never query the live database directly. Shadow-copy it **with its WAL
sidecars**, or the snapshot is stale and misleading:

```sh
cd "$(mktemp -d)"
cp ~/.local/share/kunai/kunai-data.sqlite  ./s.sqlite
cp ~/.local/share/kunai/kunai-data.sqlite-wal ./s.sqlite-wal
```

Omitting `-wal` showed a job as `running` at 86% when it was in fact
`completed` at 100% — an hour lost to a phantom.

Verify which tree is running before trusting any manual test:
`readlink /proc/<pid>/cwd`. A stale worktree 56 commits behind main produced a
"bug" that was only missing code.

## What comes after

From `2026-08-11-release-hardening-execution-board.md`, still parked:

- **PR 5** zero-install poster pipeline — 9 tasks, no open questions, branch off
  `main`. The obvious next piece of work after this one.
- **PR 2** tracker sync — 12 tasks. The live OAuth contract check with a dummy
  account is the **last step of the whole program**; Connect stays hidden or
  explicitly experimental until it passes.
- **PR 6** provider hardening — plans 037/038 stand alone; 036/AllAnime is
  best-effort-then-deprecate and goes last.
- Small self-contained PR: `kunai doctor` reports mpv/yt-dlp/ffprobe but **not
  curl**, which the default AniDB provider requires.
