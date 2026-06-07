# Offline ⇄ Online Parity — Unify the Playback Pipeline

Date: 2026-06-07
Status: Spec (approved direction: **unify the pipeline**). Touches the playback core — read `.docs/architecture.md` before executing.

## Goal
A downloaded episode and a streamed one are the **same experience**: autoplay-next, autoskip intro/outro, resume position, history, up-next — all identical. The user never thinks "offline mode." A series can be **partly downloaded** (e.g. E1–E3 local, E4+ stream) and playback **crosses that boundary seamlessly** during autoplay. Switching a given episode online↔offline is one keystroke.

## What already exists (reuse, don't rebuild)
- **`SourceSelectionEngine`** (`domain/playback-source/SourceSelectionEngine.ts`) — pure, tested. `decide({ entrypoint, local: { status, jobId }, networkAvailable, preference })` → `{ source: "local"|"online"|"blocked", shouldResolveOnline, actions: [play-local | watch-online | repair-local | browse-offline] }`. **This is the seam.** Per-episode local status already drives the choice, so mixed playback is just "call decide for each episode."
- **`OfflineAssetService.listByTitleIds`** — what's downloaded, by title (→ badges + per-episode status).
- **`offline-history-progress.ts`** + `OfflineLibraryService.savePlaybackHistory` — offline history persistence.
- **Online pipeline** — `PlaybackPhase` already owns autoplay (`resolveNextUp`), autoskip, resume, history, up-next.
- **Separate offline path** — `workflows.ts` `playOfflineEpisode` → `player.playLocal(...)`. This is what we **collapse into** the unified pipeline.

## Architecture — one pipeline, source-resolved per episode
The online pipeline already does "resolve a source for episode N → play → on end, resolve next." The change: **the source step consults `SourceSelectionEngine`**:

1. **Per-episode source resolution.** Before playing episode N, look up its local status (`OfflineAssetService`) and call `SourceSelectionEngine.decide(...)`. `local` → use the verified local file as the playback source (no provider resolve). `online` → the existing provider resolve. Either way the result feeds the **same** play call + the same history/resume/autoskip wrapper.
2. **Mixed autoplay.** `resolveNextUp` is unchanged; when it yields the next episode, that episode runs its own per-episode decision. E1–E3 play local, E4 silently resolves online — no mode switch, no prompt, same countdown.
3. **Source toggle (online↔offline).** The engine already emits `play-local` / `watch-online` actions. Surface them: (a) a playback key/command to re-resolve the current episode as the *other* source; (b) in the start/episode pickers when both exist. Default preference stays `prefer-local` (offline is faster/free) with a config to flip to `prefer-online`.
4. **Timing parity.** Fetch + persist AniSkip/intro-outro timing **at download time** (store beside the job / offline asset) so offline autoskip works with no network; fall back to fetch-on-play when online. This fixes the "timing missing" you saw.
5. **Resume/history parity.** One progress record per (title, episode) regardless of source — watch 10 min online, finish offline, same number. (offline-history-progress already writes history; ensure it reads the same resume the online path uses.)

## Badges & discoverability (the UX you asked for)
- **`isEpisodeDownloaded(titleId, season, episode)` / `downloadedCountForTitle(titleId)`** helpers over `OfflineAssetService`.
- **Episode lists / pickers:** a small `↓` (or "offline") tag per downloaded episode; series rows show `↓ 3/13` when partly downloaded.
- **Start picker:** when an episode exists both ways, show both `▶ Play downloaded` and `≈ Watch online` (engine actions) — switching is one selection.
- Downloaded items live in the **same** history / continue / up-next surfaces with a badge, not a separate world.

## Tasks (TDD, each gate-green)
1. `isEpisodeDownloaded` + `downloadedCountForTitle` (pure, over OfflineAssetService) — unit-tested.
2. Per-episode source resolution in the playback pipeline: route `local` decisions to the local-file source through the same play+history path (collapse `playOfflineEpisode` into it). Behind a seam so the online path is untouched when no local copy exists.
3. Mixed autoplay: verify `resolveNextUp` → per-episode decision crosses the boundary (test: E1 local, E2 online).
4. Source-toggle action (key/command) + start-picker `Play downloaded / Watch online` when both exist.
5. AniSkip/intro timing persisted at download; offline autoskip reads it.
6. `↓` badges in episode/series/history lists; `↓ n/total` for partial.
7. Gates + live-verify (offline autoplay, autoskip, resume, the toggle, mixed boundary).

## Non-goals
- Background download daemon (v2).
- Re-encoding/transcoding local files.

## Cross-refs
[[project_offline_and_downloads]] (decisions) · `.docs/architecture.md` · `.docs/download-offline-onboarding.md` · Up Next spec (resolveNextUp).
