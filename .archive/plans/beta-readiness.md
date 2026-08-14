# Kunai — Beta Readiness Plan

Status: Active

Last updated: 2026-05-08

This plan tracks the work needed to ship a releasable public beta. It is the operational companion to the roadmap.
Everything here is concrete and ordered. Each item is either done, in progress, or explicitly deferred.

Product pillars and architecture contracts (playback, subtitles, cache seams, telemetry posture): [kunai-beta-v1-scope-and-contracts.md](kunai-beta-v1-scope-and-contracts.md).  
Sequencing, CLI minimal/quick flags, autoskip behavior notes: [kunai-execution-passes-and-cli-modes.md](kunai-execution-passes-and-cli-modes.md).

---

## Immediate Publish Passes (ordered)

These are the recommended passes to finish beta publish safely without broad UX feature expansion:

1. **Publish hygiene pass**
   - finalize README for real users
   - finalize package metadata and tarball contents
   - run `bun run pkg:check` and `bun run release:dry-run`
2. **Legacy quarantine pass**
   - move legacy runtime references into `archive/legacy/**`
   - keep active runtime free of legacy imports
3. **Boundary hardening pass**
   - enforce import fences in architecture tests
   - keep app-shell isolated from provider/player runtime internals
4. **Live reliability pass**
   - verify autoplay near-EOF behavior on real sessions
   - confirm diagnostics clearly explain fallback/recovery outcomes
5. **Beta release pass**
   - re-run typecheck/lint/fmt/test/pkg/release checks
   - publish only after all blocking checklist items are complete

---

## Consensus Decisions (locked)

- **Runtime target**: CLI-first. Web, desktop, cloud parked until CLI is excellent.
- **Timing sources**: IntroDB handles all content; AniSkip supplements anime-only. Merged per-field (IntroDB wins where it has data).
- **Package extraction order**: `@kunai/types` → `@kunai/catalog` → `@kunai/core`. Everything else stays in `apps/cli` until a second consumer pulls on it.
- **No premature packages**: extract only when the interface is stable and a second consumer exists or is imminent.
- **Autoplay**: must work automatically — user should never need to press N at EOF for a natural end.
- **Fullscreen**: the shell must fill the entire terminal viewport. No gap rows.

---

## Track 1 — Playback Reliability (highest user impact)

### Done

- [x] Autoplay end-reason promotion (`eof-reached` fallback in `applyEndFileEvent`)
- [x] mpv N/P/I keys wired through Lua → `user-data/kunai-request` → `PlayerControlService`
- [x] OSD feedback on episode transition (`show-text` IPC)
- [x] Near-EOF prefetch of next episode stream
- [x] mpv window title update on episode transition (`set_property force-media-title`)
- [x] `didPlaybackEndNearNaturalEnd` position-ratio fallback (95% of lastNonZero for HLS sources)
- [x] Autoplay diagnostics recorded before `resolveAutoplayAdvanceEpisode` (visible in overlay)
- [x] Anime episode cache key scoped to `${providerId}:${titleId}` (was only provider ID)
- [x] `onNearEof` fired at `end-file` as fallback when duration was never reported

### Remaining

- [x] N/P navigation no longer sets `autoplayPaused` — pressing N in mpv mid-episode no longer blocks autoplay for all subsequent episodes
- [x] Anime episode fallback is optimistic when count and list are both unknown (uses `episode + 1` instead of 0 as `fallbackMax`)
- [ ] Verify autoplay works end-to-end for AllAnime (run a real session, check diagnostics overlay) — procedure: play a series episode with auto-next on; confirm diagnostics shows “Evaluating autoplay advance” then “Auto-next advancing…”; EOF or near-end quit with **continue** policy should advance without pressing N
- [x] `quitNearEndBehavior` + `quitNearEndThresholdMode` in persisted config, list settings, and Ink settings overlay
- [x] Stream cache for API resolves: `PlaybackPhase` reads/writes `CacheStore` on resolve (plus prefetch); refresh clears entry. Embed scrapes still keyed by embed URL in `BrowserServiceImpl`. AllManga episode-detail GraphQL deduped in `@kunai/providers` (short TTL).
- [ ] Optional hardening: single cache-key builder driven by manifest `cachePolicy` (orchestration still split across callers today)

---

## Track 2 — Timing Sources (done)

### Done

- [x] `PlaybackTimingAggregator` with `PlaybackTimingSource` interface in `src/infra/timing/`
- [x] `IntroDbTimingSource` — covers all content types
- [x] `AniSkipTimingSource` — anime-only, routes by `mode === "anime"`, uses AniList ID → MAL ID via arm.haglund.dev
- [x] `mergeTimingMetadata` — IntroDB fields preferred, AniSkip fills gaps
- [x] `PlaybackPhase` uses aggregator; IntroDB and AniSkip fetched in parallel

### Remaining

- [x] `mergeTimingMetadata` lives in `apps/cli/src/infra/timing/merge-timing.ts` (Track 2 extraction done)

---

## Track 3 — Fullscreen Shell (visible quality)

### Done

- [x] `shellWidth` and `shellHeight` use full terminal dimensions (removed `-1`/`-2` offsets)
- [x] `alternateScreen: true` confirmed on both render paths
- [x] **Slice 1**: Root owns the only fullscreen frame — `AppRoot` has the single `borderStyle="round"`, child shells use borderless `ShellFrame`
- [x] **Slice 2**: Child shells flattened — browse, picker, loading render as flat content inside the root frame; no nested card borders

### Done (continued)

- [x] **Slice 3**: Browse composition — wide-terminal companion pane with 70/30 split; `buildBrowseCompanionPanel` wired in
- [x] **Slice 5**: Root overlays — settings, history, diagnostics, season, episode, subtitle all stay inside shell via `RootOverlayShell`

### Remaining

- [x] **Slice 4**: Playback/loading/post-playback visual continuity — `LoadingShell` keyed by title+episode to reset spinner state on autonext; “Loading next episode” playback feedback during advance

---

## Track 4 — History UI Improvements

### Done

- [x] History panel shows title, episode marker, progress %, provider, and date per entry
- [x] Netflix-style visual progress bars (`[██████░░░░]`) and color-coded status badges for completed vs. watching
- [x] History panel supports filtering (by title/provider/episode in `RootOverlayShell`)
- [x] Smart filtering for 'completed' (>= 95% watched) and 'watching' states directly in the search bar
- [x] Continue-watching from history entry: `chooseStartingEpisode` reads history timestamp and pre-selects episode + resume position

---

## Track 5 — Package Extraction (architecture)

### Done

- [x] `@kunai/types` exists (domain contracts)
- [x] `@kunai/storage` partially migrated (SQLite-backed stores)
- [x] `@kunai/providers` has VidKing + AllManga

### Remaining

- [ ] Extract `@kunai/types` from `src/domain/types.ts` fully (currently duplicated between local and package)
- [ ] `@kunai/catalog` — TMDB/AniList/MAL ID mapping (currently split across `tmdb.ts`, `aniskip.ts`, provider adapters)
  - Scope: ID resolution, episode catalog, search result normalization
  - Benefit: enables future web/desktop without reimplementing metadata layer
- [ ] `@kunai/core` timing aggregator + resolver orchestration
  - Only after `PlaybackTimingAggregator` interface is stable (it is now)

---

## Track 6 — First-Run Guardrails

### Done

- [x] `checkDeps()` in `ui.ts` checks for mpv and exits with install instructions — now wired into `runCli` before container init

### Remaining

- [x] Startup capability checks are non-blocking for optional dependencies and only block missing `mpv`; see [.docs/quickstart.md](../.docs/quickstart.md)
- [ ] Ideally: friendly guided setup flow in the shell itself

---

## Beta Acceptance Checklist

Before calling this a releasable public beta, ALL of the following must be true:

- [x] Autoplay advances automatically at natural EOF for both series (TMDB) and anime (AllAnime) — live verified
- [x] N/P/I keys work inside mpv window
- [x] Shell fills terminal viewport (no gaps)
- [x] Settings, history, diagnostics all accessible without leaving the shell
- [x] Skip-credits setting exposed in settings overlay
- [x] First-run guardrail for missing mpv
- [x] History UI shows enough detail to be useful
- [x] `bun run typecheck` clean; `bun run lint` — **0 errors**, warnings allowed under [.docs/lint-policy.md](../.docs/lint-policy.md) until burn-down batches land

---

## Deferred (not blocking beta)

- Unified stream-cache policy layer (manifest `cachePolicy` → one orchestration helper; today persistence is correct but keying rules live in multiple modules)
- Image/poster backend extraction
- Full Phase 4G provider package migration (rest of providers)
- Search service refactor
- Trailer/teaser playback
- App rename
- Web/desktop surfaces
