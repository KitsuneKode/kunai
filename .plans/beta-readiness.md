# Kunai — Beta Readiness Plan

Status: Active

Last updated: 2026-05-03

This plan tracks the work needed to ship a releasable public beta. It is the operational companion to the roadmap.
Everything here is concrete and ordered. Each item is either done, in progress, or explicitly deferred.

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
- [ ] Verify autoplay works end-to-end for AllAnime (run a real session, check diagnostics overlay)
- [ ] `quitNearEndBehavior` config knob (policy exists, setting not exposed in settings overlay)
- [ ] Stream cache write after resolve (currently `cachePolicy` object is built but never written to `CacheStore`)

---

## Track 2 — Timing Sources (done)

### Done

- [x] `PlaybackTimingAggregator` with `PlaybackTimingSource` interface in `src/infra/timing/`
- [x] `IntroDbTimingSource` — covers all content types
- [x] `AniSkipTimingSource` — anime-only, routes by `mode === "anime"`, uses AniList ID → MAL ID via arm.haglund.dev
- [x] `mergeTimingMetadata` — IntroDB fields preferred, AniSkip fills gaps
- [x] `PlaybackPhase` uses aggregator; IntroDB and AniSkip fetched in parallel

### Remaining

- [ ] Extract `mergeTimingMetadata` from `aniskip.ts` into `src/infra/timing/` (currently imported from aniskip module)

---

## Track 3 — Fullscreen Shell (visible quality)

### Done

- [x] `shellWidth` and `shellHeight` use full terminal dimensions (removed `-1`/`-2` offsets)
- [x] `alternateScreen: true` confirmed on both render paths

### Remaining (ordered by slice from fullscreen-root-shell-redesign.md)

- [ ] **Slice 1**: Remove disconnected inner border that double-wraps child shells
- [ ] **Slice 2**: Flatten child shell borders — browse, picker, loading no longer draw full outer borders
- [ ] **Slice 3**: Browse composition — rebalance list vs companion column widths
- [ ] **Slice 4**: Playback/loading/post-playback visual continuity
- [ ] **Slice 5**: Root overlays — settings, history, diagnostics, season, episode, subtitle all stay inside shell

---

## Track 4 — History UI Improvements

### Remaining

- [ ] History panel shows more detail per entry (episode name, provider, completion %, date)
- [ ] History panel supports filtering by title
- [ ] Continue-watching shortcut from history entry (jump directly to playback with correct resume point)

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

### Remaining

- [ ] On startup, check for `mpv` and Playwright — show clear error with install instructions if missing
- [ ] Ideally: friendly guided setup flow in the shell itself

---

## Beta Acceptance Checklist

Before calling this a releasable public beta, ALL of the following must be true:

- [ ] Autoplay advances automatically at natural EOF for both series (TMDB) and anime (AllAnime)
- [ ] N/P/I keys work inside mpv window
- [ ] Shell fills terminal viewport (no gaps)
- [ ] Settings, history, diagnostics all accessible without leaving the shell
- [ ] `quitNearEndBehavior` setting is exposed
- [ ] First-run guardrail for missing mpv
- [ ] History UI shows enough detail to be useful
- [ ] `bun run typecheck && bun run lint` pass clean

---

## Deferred (not blocking beta)

- AllAnime stream cache write (prefetch covers the important case)
- Image/poster backend extraction
- Full Phase 4G provider package migration (rest of providers)
- Search service refactor
- Trailer/teaser playback
- App rename
- Web/desktop surfaces
