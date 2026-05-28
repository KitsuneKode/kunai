# Design — History & Continuation Read Model (Plan 1)

Date: 2026-05-28
Status: approved (brainstorm), pending implementation plan
Branch context: `design/sakura-canonical`

This is **Plan 1 of 5** in the Kunai backend/UX hardening roadmap (see
[Roadmap](#roadmap-context) at the end). It is the foundational slice: it
establishes the single source of truth for "what do I play next, and how is it
shown" — the **consumer** side of the release/continuation system. Plan 2
(release/airing correctness) is the **producer** side and targets the contract
this spec defines.

---

## 1. Problem

History and continue-watching are spread across two stacked layers and two
near-duplicate reconciliation engines, with a lossy adapter in the middle.

- **Two history layers.** A SQLite `HistoryRepository` (`packages/storage`, full
  per-episode fidelity) is wrapped by a `HistoryStore` facade
  (`SqliteHistoryStoreImpl`) that re-serves the legacy `HistoryEntry` shape.
- **Lossy collapse.** `HistoryStore.getAll()`/`listRecent()` and `toHistoryEntry`
  flatten data: one row per title in `getAll`, `mediaKind` flattened to
  `series|movie`, `duration ?? 0`, `provider ?? "unknown"`. Per-episode progress
  that SQLite stores is invisible above the facade.
- **Two reconciliation engines.** `reconcileContinueHistory`
  (`domain/continuation/history-reconciliation.ts`) and `projectContinuationState`
  (`services/continuation/continuation-policy.ts`) both filter-by-title, sort by
  recency, find unfinished, then branch to new-episode/up-to-date. They have
  drifted: `main.ts` uses the richer projection with real multi-episode rows;
  every other caller uses `reconcileContinueHistory` with **single-entry** input,
  so its multi-episode logic is dead.
- **Wrong resume rule.** Both engines do `entries.find(!isFinished)` over
  recency-sorted rows, which resumes an **older abandoned** episode when the most
  recent one is finished — the opposite of Netflix/Crunchyroll behavior.
- **`duration:0` stranding.** Read-time `isFinished` re-derives completion from a
  95% ratio. When a provider reports `duration: 0` (live HLS, some sources), a
  genuinely finished episode never clears and sticks in Continue forever.

## 2. Decisions (locked during brainstorm)

1. **Resume rule = Netflix/Crunchyroll anchor.** Store per-episode truth (already
   does). Decide off the **most-recent** episode for a title: resume it if
   unfinished, else advance to the next step. Never scan back to an older
   abandoned episode. Recency orders the Continue row.
2. **Retire the facade.** Delete `HistoryStore` + `HistoryEntry` + the dead JSON
   `HistoryStoreImpl` + the lossy `SqliteHistoryStoreImpl`. `HistoryProgress`
   becomes the only history row type. One focused read model serves continuation
   logic.
3. **One engine.** Merge the two reconciliation engines into one, fed per-episode
   rows everywhere, with the anchor rule corrected.
4. **Completed flag is finished-authority.** Trust the write-time `completed`
   flag (computed richly from credits/threshold/EOF). The 95% ratio is only a
   fallback when `durationSeconds > 0`.

## 3. Architecture

```
RELEASE/AIRING PRODUCER  →  local cache (release_progress + schedule)  →  CONTINUATION CONSUMER  →  UI showcase
   (Plan 2)                    (read-only here)                           (this spec)               (badges)
```

Plan 1 only **reads** the local cache — it never triggers a network fetch. That
is the read-layer "no overfetch" guarantee. Whether the cached projection is
_correct_ (cross-cour, numbering, no writer race) is Plan 2.

### 3.1 Data model & types

- **Canonical row:** `HistoryProgress` (already in `@kunai/storage`) is the only
  history shape. It is already lossless:
  `titleId, mediaKind, title, season, episode, absoluteEpisode, positionSeconds,
durationSeconds, completed, providerId, externalIds, updatedAt, createdAt`.
- **New util** `services/continuation/history-progress.ts`:
  - `isFinished(p)` and `formatTimestamp(seconds)`, moved off the dying facade.
- **Deletions:**
  - `apps/cli/src/services/persistence/HistoryStore.ts` (interface, `HistoryEntry`,
    old `isFinished`/`formatTimestamp`)
  - `apps/cli/src/services/persistence/HistoryStoreImpl.ts` (dead JSON impl)
  - `apps/cli/src/services/persistence/SqliteHistoryStoreImpl.ts` (lossy adapter)
  - `apps/cli/src/domain/continuation/history-reconciliation.ts` (starved duplicate)
  - `container.historyStore` field (only `historyRepository` remains)
- **Layering:** the merged engine stays in `services/continuation` (not `domain/`)
  because it legitimately depends on the storage row type and the release
  projection. `domain/continuation/watch-progress.ts` (pure projection) and the
  offline `domain/continuation/ContinuationEngine.ts` are untouched.

### 3.2 Unified engine + anchor rule + finished rule

**One engine:** `projectContinuationState` (in `continuation-policy.ts`) is the
survivor, retyped `HistoryEntry → HistoryProgress`, taking per-episode `rows`
(not tuples). It stays a **pure function** (no IO) for testability.

Signature (conceptual):

```ts
projectContinuationState(input: {
  titleId: string;
  rows: readonly HistoryProgress[];
  nextRelease?: ContinuationNextRelease | null;
  newSeason?: NewSeasonSignal | null;        // consumed if present (produced by Plan 2)
  knownNextEpisode?: { season: number; episode: number } | null; // local evidence only
  offline?: { enrolled: boolean; readyNextEpisodes: EpisodeRef[] } | null;
  releaseProgress?: { newEpisodeCount: number; stale?: boolean } | null;
}): ContinuationProjection
```

**Anchor rule (the behavior fix):**

```
rows   = historyRepository.listByTitle(titleId)   // full per-episode fidelity
anchor = rows sorted by updatedAt desc → [0]       // most-recent activity, NOT a scan
if !isFinished(anchor):
    → resume(anchor.season, anchor.episode, anchor.positionSeconds)
else:
    → advance, in precedence order:
        offline-ready ▸ new-episodes(+N) ▸ new-season ▸ airing-weekly/upcoming ▸ up-to-date
```

The deleted behavior is the `.find(unfinished)` scan. Per-episode truth is still
used for: episode-picker progress dots (`listByTitle`) and direct-episode resume
(`getProgress(title, episode)` returns _that_ episode's own position).

`knownNextEpisode` / `next-up` is emitted only when local evidence exists
(offline-ready, release projection `released`, or a cached catalog episode count
showing `anchor < total`). Absent evidence we emit `up-to-date`/`airing-weekly`
rather than fabricating a next episode.

**Continue Watching row (across titles):** `listRecent` → group by `titleId` →
take each title's most-recent row → order groups by that row's `updatedAt`. One
anchor per title, recency-ordered.

**Finished rule (single authority):**

```ts
isFinished(p) =
  p.completed || (p.durationSeconds > 0 && p.positionSeconds / p.durationSeconds >= 0.95);
```

The `completed` flag wins; ratio is only a `durationSeconds > 0` fallback. Kills
the `duration:0` stranding bug.

### 3.3 Showcase-state vocabulary

Every history/continue tile resolves to exactly one state with its own badge:

| State           | Meaning                                                           | Badge example    |
| --------------- | ----------------------------------------------------------------- | ---------------- |
| `resume`        | most-recent episode unfinished                                    | "Resume · 12:43" |
| `next-up`       | most-recent finished, next episode available now (local evidence) | "Next: E12"      |
| `new-episodes`  | `+N` aired since caught up                                        | "+3 new"         |
| `new-season`    | sequel cour/season exists (Plan 2 signal)                         | "New season"     |
| `airing-weekly` | caught up, next airs on schedule                                  | "Sun · S2E12"    |
| `up-to-date`    | caught up, no known next                                          | "Caught up"      |
| `offline-ready` | a downloaded episode is the next step                             | "Downloaded"     |

Plan 1 emits these from local cache only; Plan 2 keeps the data behind
`new-episodes` / `new-season` / `airing-weekly` honest.

### 3.4 Service surface

`ContinueWatchingService` (renamed/extended `ContinuationProjectionService`),
injected with `historyRepository` + local release/offline cache readers. IO +
orchestration only; decisions delegate to the pure engine.

1. `projectTitle(titleId)` → fetch `listByTitle`, compute anchor + state.
2. `recentRow(limit)` → `listRecent` grouped to one anchor per title,
   recency-ordered (the Continue Watching list).
3. `episodeProgress(titleId)` → per-episode rows passthrough for picker dots.

Badge consumers use a thin `badgesFor(projection)` adapter over the projection.

### 3.5 Caller migration (~15 sites)

| Bucket                  | Sites                                                                                                                                                                                 | Target                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Write**               | `PlaybackPhase.ts:1917`                                                                                                                                                               | `historyRepository.upsertProgress` via a small write helper mapping the playback result                 |
| **Raw rows**            | `runtime-bindings:102`, `workflows:348/1307/1451/1498/1502/2738`, `calendar-results:35`, `discover-sections:21/25`, `SearchPhase:188/750`, `session-flow:127`, `main:283/286/303/426` | `historyRepository.listRecent/listByTitle`; a shared `groupLatestByTitle` helper for "latest per title" |
| **Projection / badges** | `main:299`, `ResultEnrichmentService:68/147`, `history-view`(×4), `panel-data:873/903`, `root-history-bridge:55/102`                                                                  | `ContinueWatchingService` + `badgesFor` adapter                                                         |

`workflows.ts:3235` already uses `historyRepository` directly — the target pattern.

## 4. Testing (TDD, pure engine first)

- **Anchor:** mid-anchor → `resume`; finished-anchor **with an older unfinished
  episode → advance, NOT resume-old** (regression guard for the rejected
  behavior); finished + `+N` → `new-episodes`; finished + sequel → `new-season`;
  finished + upcoming → `airing-weekly`; finished + nothing → `up-to-date`;
  offline-ready precedence; empty.
- **`isFinished`:** flag wins; `duration:0` not finished unless flag; `≥0.95`
  only when `duration>0`.
- **Continue-row grouping:** many titles → one anchor each, recency order.
- **Service:** against a fake `historyRepository`.
- **Snapshots:** update history-view/panel-data/calendar captures intentionally;
  delete facade/old-engine tests, port useful cases.

## 5. Out of scope (belongs to later plans)

- Cross-cour / new-season **data** correctness, numbering-axis reconciliation,
  calendar-vs-reconciliation writer race, `sourceFingerprint` dedup, cache
  pruning, any network fetch, the `new_season_json` storage migration → **Plan 2**.
  Plan 1 _consumes_ a `newSeason` signal if present but never _computes_ it.
- **No storage migration in Plan 1** — `HistoryProgress` schema is unchanged.
- Unified `PlayableRef` across queue/playlists/history/downloads → **Plan 3**.
- `PlaybackPhase` decomposition → **Plan 4**.
- mpv OSD, provider-switch affordance, `--alang=dub` fix, English-fallback fix,
  presence teardown → **Plan 5**.

## 6. Edge cases

- **Movies** (no season/episode): anchor = the single row; resume if unfinished
  else `up-to-date`. `mediaKind` preserved (no flatten-to-series).
- **`absoluteEpisode`-only titles:** anchor uses `episode ?? absoluteEpisode`;
  per-episode keying via `createHistoryKey` already handles this.
- **Legacy `completed:false` + `duration:0` rows:** accepted without migration;
  self-heal on next watch.

## Roadmap context

1. **Plan 1 — History + Continuation read model** (this spec).
2. **Plan 2 — Release/airing reconciliation correctness** — adopts
   `.docs/audit-airing-episodes.md`: AniList SEQUEL traversal, TMDB later-season
   probing, numbering-axis reconciliation, unify projection writers, use
   `sourceFingerprint`, prune stale, filler classification, TMDB date precision,
   wire-or-remove `new-playable-episode`.
3. **Plan 3 — Unified playable identity + Up Next** — one `PlayableRef` across
   queue/playlists/history/downloads; merge episode-chain + cross-title queue.
4. **Plan 4 — `PlaybackPhase` decomposition** — behavior-preserving split of the
   3965-line file / ~2500-line `execute()`.
5. **Plan 5 — Playback/UX polish** — mpv OSD (skip/next), explicit provider-switch
   affordance, `--alang=dub` fix, subtitle English-fallback fix, Discord presence
   teardown on all exits.

Plans 1 and 2 are the coupled pair and land first (Plan 1 defines the contract).
Plan 3 follows Plan 1's identity decisions. Plans 4 and 5 are independent.
