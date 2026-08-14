# Plan 032: Make sync identity-safe and describe real capabilities

> **For agentic workers:** use test-driven development and verification-before-completion.
>
> **Drift check:** `git diff --stat 36da54c4..HEAD -- apps/cli/src/services/sync apps/cli/src/app-shell/workflows/shell-workflows.ts apps/cli/src/app/playback/PlaybackPhase.ts apps/cli/src/domain/session/command-registry.ts packages/config/src/defaults.ts packages/config/src/types.ts docs/feature-status.yaml`

**Goal:** Sync must never mutate the wrong remote title, regress AniList progress, or
claim TMDB episode-progress support that TMDB does not provide.

**Architecture:** Make adapter capabilities explicit. Sync accepts a canonical
remote identity, not an ambiguous local `titleId`. AniList is the only watch-progress
adapter. TMDB may remain an account/watchlist integration, but it must not satisfy or
receive a `pushProgress` operation.

## Status

- **Priority:** P0
- **Effort:** M
- **Risk:** HIGH (remote account mutation)
- **Planned at:** `36da54c4`, 2026-08-11

## Confirmed defects

- `AniListAdapter.ts:232-237` treats `mal:<n>` and `tmdb:<n>` as if the number were
  an AniList media id. Those id spaces are unrelated.
- `TmdbAdapter.ts:122-146` calls the watchlist endpoint with `watchlist:false`; this
  removes a title from a list and does not sync episode progress.
- `shell-workflows.ts:3100-3119` pushes the latest 20 history rows individually.
  Multiple episodes of the same title can push a newer episode and then regress it
  with an older row.
- Playback only displays a sync nudge (`PlaybackPhase.ts:2389-2397`); no successful
  history write automatically queues a sync operation.
- Persisted `enabled`, `trackWatched`, and `syncList` fields have no production
  readers. The command copy nevertheless promises watch-progress sync.
- Connect/disconnect-specific commands all open the same generic screen.

## Tasks

### Task 1: Fail closed before any remote mutation

- [ ] Add adapter tests proving AniList accepts only an explicit AniList id. MAL,
      TMDB, bare numeric, and provider-native ids must return a mapping error and make no
      request.
- [ ] Remove the MAL/TMDB fallthrough from `extractAniListId`.
- [ ] Stop `SyncService.pushWatched` from invoking TMDB. Add an explicit capability
      such as `progress: "episode" | "none"` to the sync adapter interface and select
      adapters by the requested operation.
- [ ] Relabel or hide TMDB progress actions. Do not replace the current call with a
      different TMDB mutation without a separately specified product meaning.

### Task 2: Introduce a canonical sync input

- [ ] Replace `pushWatched(HistoryProgress)` at the adapter seam with a small input
      containing progress plus explicit external ids, for example
      `SyncProgressUpdate { anilistId?: string; tmdbId?: string; mediaKind; episode?; completed }`.
- [ ] Resolve identities before crossing the seam using existing catalog/history
      metadata. Low-confidence or absent crosswalks skip with a diagnostic; they never
      guess by numeric equality.
- [ ] Test AniDB/provider-native history with and without a proven AniList crosswalk.

### Task 3: Aggregate monotonically

- [ ] Extract a pure builder that groups history rows by canonical title and emits
      one update with maximum proven episode progress.
- [ ] Add tests with recent rows in both orders, repeated episodes, movies, and mixed
      titles. No ordering may reduce remote progress.
- [ ] Have manual `Sync now` report titles attempted, not raw history rows pushed.

### Task 4: Make configuration and commands real

- [ ] Either wire `sync.<adapter>.enabled/trackWatched/syncList` to documented
      behavior or delete them. Do not keep unread persisted switches.
- [ ] `sync-connect-anilist` must start/select AniList; `sync-connect-tmdb` must
      start/select TMDB; `sync-disconnect` must select only connected adapters.
- [ ] Update command descriptions and `docs/feature-status.yaml` to say exactly what
      each adapter supports. Keep the feature experimental until an opt-in live mutation
      test passes with a disposable account.

### Task 5: Add automatic AniList progress delivery safely

- [ ] After a successful durable history write, enqueue one best-effort AniList
      update only when `trackWatched` is enabled and identity is proven.
- [ ] Do not await remote sync on the playback/UI path. Use a bounded, deduplicated
      queue with retry/backoff and last-write-wins progress per title.
- [ ] Persist enough pending state to survive a clean exit, or explicitly keep this
      manual-only for the release. Do not claim automatic sync without that behavior.

## Release-today safe cut

If Task 5 cannot be completed today, ship Tasks 1-4, keep sync explicitly
experimental/manual, and remove the automatic-progress wording. Wrong remote writes
are worse than a missing integration.

## Verification

```sh
bun run --cwd apps/cli test:file test/unit/services/sync/SyncService.test.ts
bun run --cwd apps/cli test:file test/unit/services/sync/anilist-adapter.test.ts
bun run typecheck
bun run lint
bun run fmt:check
bun run test
```

An opt-in live test may verify OAuth and one disposable AniList title; it must never
run in the default suite or use a maintainer's real library.
