# Kunai UI/UX Overhaul — Implementation Plan

**Date**: 2026-05-14
**Status**: Partially Implemented (Phases 1, 2, 3, 5 complete; Phases 2 wire, 4, 6 deferred)
**Scope**: Loading states, playback supervision, post-playback recommendations, offline library, language picker, stream health

---

## 1. Goal

Receive the same level of experience one can have in a web browser or streaming service in a CLI tool — without compromising on features, stability, and reliability.

---

## 2. Confirmed Issues

| #   | Issue                                       | Current State                                                       | Severity |
| --- | ------------------------------------------- | ------------------------------------------------------------------- | -------- |
| 1   | Initial screen `[/ /]` duplication          | Footer renders both `/` glyph and `/` label                         | Trivial  |
| 2   | Playback screen too bland                   | Only title, generic "MPV is active", provider, subtitle status      | High     |
| 3   | Post-playback recommendation placement      | `recommendationRailItems` in state but not rendered                 | High     |
| 4   | `/recommendation` goes to home screen       | Mutates search results and returns `back_to_search`, losing context | High     |
| 5   | Library/offline view inaccessible from home | `--offline` and `/library` both open download manager overlay only  | High     |
| 6   | Downloaded content not easily playable      | Needs explicit `r`/`Enter`; no "Play from library" flow             | Medium   |
| 7   | Loading states unclear                      | "Resolving provider data, timing, and player startup" is vague      | High     |
| 8   | Stream health not validated                 | Cached URLs may die; no proactive health check                      | Medium   |
| 9   | Dub/lang support scattered                  | Language profiles in settings; no surface visibility                | High     |

---

## 3. Design Decisions

### A. Playback Screen — "Cockpit Lite"

4-section layout, refreshed on IPC events (not intervals):

1. **Primary context**: Title, SxEx, provider, mode badge
2. **Playback telemetry**: Position/duration (only if changing), quality label, buffer health (3-state)
3. **Track info**: Active audio + subtitle language (one line each)
4. **Up-next preview**: If autoplay enabled, show `Next: SxEx — Title`

### B. Post-Playback — Inline Rail + Full Overlay

- Render `recommendationRailItems` as compact horizontal rail (3 titles)
- `/recommendation` opens a session overlay (`recommendation_picker`) like `e`/`k`/`o`, not search mutation

### C. Loading States — 3 High-Level Stages

Replace vague text with:

1. **Finding stream** — Provider resolution, direct link, subtitles
2. **Preparing player** — AniSkip/timing, mpv args, IPC socket
3. **Starting playback** — mpv launch, seek, stream validation, ready signal

Each stage has sub-status + immediate error surfacing with recovery actions.

### D. Offline Library — Hybrid Model

1. **Overlay** (`/downloads`, `/library`): Active jobs + recent completed with play buttons
2. **Top-level screen** (`/library` full): Browsable completed downloads with metadata
3. **Inline badges**: Search results show `⬇ offline` if available locally

### E. Language/Dub — Consolidated "Media Preferences" Picker

New overlay type `media_preferences_picker` accessible via `/tracks` or key `t`:

- Audio: Available languages + current + default from settings
- Subtitles: Available tracks + current + default
- Quality: Current quality

Context-aware: uses already-resolved `stream.subtitleList`, `stream.qualityOptions`.

### F. Stream Health Validation

`StreamHealthService`:

- `HEAD` request before handing cached URL to mpv
- Check if cache > 2 hours old
- Dead -> transparent refetch; fallback if still dead
- Metrics logged to diagnostics

---

## 4. Implementation Phases

| Phase  | Focus                                                     | Status   | Key Files                                                                                                                                                 |
| ------ | --------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**  | Loading states (3-stage clarity + error surfacing)        | Complete | `loading-shell.tsx`, `loading-shell-runtime.ts`                                                                                                           |
| **2**  | Playback screen richness (cockpit lite + track info)      | Complete | `loading-shell.tsx`, `types.ts`, `ink-shell.tsx`                                                                                                          |
| **2b** | Wire live mpv IPC telemetry into playback supervision     | Deferred | `PersistentMpvSession.ts`, `PlayerControlService.ts`, `ink-shell.tsx`                                                                                     |
| **3**  | Post-playback recommendations (inline rail + overlay fix) | Complete | `PlaybackPhase.ts`, `command-router.ts`, `session-picker.ts`, `root-overlay-shell.tsx`, `root-overlay-model.ts`, `root-shell-state.ts`, `SessionState.ts` |
| **4**  | Language picker (`/tracks`) + surface labels              | Deferred | `command-registry.ts`, `session-picker.ts`, provider adapters                                                                                             |
| **5**  | Stream health validation                                  | Complete | `PlaybackResolveService.ts`                                                                                                                               |
| **6**  | Offline library overhaul (hybrid model)                   | Deferred | `OfflineLibraryPhase.ts`, `download-manager-shell.tsx`, `workflows.ts`                                                                                    |

---

## 5. What Was Implemented

### Phase 1 — Loading Shell Redesign

- Added `LoadingShellStage` type (`finding-stream` | `preparing-player` | `starting-playback`) to `types.ts`
- Added `stage` and `stageDetail` fields to `LoadingShellState`
- Rewrote `loading-shell-runtime.ts` with:
  - `resolveStageFromOperation()` mapping coarse operations to 3 stages
  - `stageLabel()` / `stageDescription()` human-readable helpers
  - `renderStageRail()` with error-aware tone coloring (turns amber/red on `latestIssue`)
  - `getProviderResolveWaitPresentation()` enriched with `stageDetail` sub-status
- Rewrote `loading-shell.tsx`:
  - Replaced 2-phase rail with 3-stage rail
  - Added `stageDetail` rendering as sub-status line
  - Stage descriptions now explain what each stage does
  - Error states surface immediately with warning/error tone instead of pulsing neutrally

### Phase 2 — Playback Supervision Richness

- Extended `LoadingShellState` with playback telemetry fields:
  - `currentPosition`, `duration`, `qualityLabel`, `bufferHealth`, `audioTrack`, `subtitleTrack`
  - `nextEpisodeLabel`, `previousEpisodeLabel`, `hasNextEpisode`, `hasPreviousEpisode`
- Added `Playback` section to `LoadingShell` when `isPlaying`:
  - Position / duration with timestamp formatting
  - Quality label when available
  - Buffer health badge (healthy/buffering/stalled)
  - Audio and subtitle track names
- Added `Navigation` section showing next/previous episode labels
- Updated `ink-shell.tsx` to populate these fields from `SessionState.episodeNavigation` and `stream.audioLanguages`

### Phase 3 — Post-Playback Recommendations

- Added `recommendation_picker` as a first-class `PickerModalOverlayState` / `OverlayState` type
- Updated `SessionState.ts` reducer, `root-shell-state.ts`, `root-overlay-model.ts`, `root-overlay-shell.tsx` to handle the new overlay type
- Added `recommendation_picker` to `session-picker.ts` `PickerOverlayInput`
- Fixed `command-router.ts` `routePlaybackShellAction` to handle `recommendation`:
  - Loads discover results via `loadDiscoverResults()`
  - Opens a `recommendation_picker` session picker overlay with results
  - Waits for selection via `waitForSessionPicker()`
  - Returns selected title as `history-entry` result (starts playback)
  - Cancelling returns to post-playback shell (no more home-screen dump)
- Removed the old `postAction === "recommendation"` mutation code from `PlaybackPhase.ts`

### Phase 5 — Stream Health Validation

- Added `cache-stale` and `cache-hit-validated` event types to `PlaybackResolveEvent`
- Added `checkStreamHealth()` helper in `PlaybackResolveService.ts`:
  - Tries `HEAD` request first (5s timeout)
  - Falls back to `GET` with `Range: bytes=0-0` if HEAD fails
  - Returns `true` for 200 OK or 206 Partial Content
- Modified `PlaybackResolveService.resolve()`:
  - After cache hit, checks `stream.timestamp` age
  - If > 2 hours old, runs `checkStreamHealth()`
  - Dead stream: deletes from cache, emits `cache-stale` event, falls through to refetch
  - Healthy stream: emits `cache-hit-validated` event, returns with `cacheProvenance: "revalidated"`
- Updated `PlaybackPhase.ts` event handler to render `cache-stale` feedback in loading shell

### Minor Fixes

- Fixed `[/ /]` duplication in footer by changing command-mode glyph from `/` to `⌘`

---

## 6. Remaining Work (Deferred)

### Phase 2b — Live MPV Telemetry Polling

**Why deferred**: Requires adding `getTelemetrySnapshot()` to `ActivePlayerControl` interface and implementing it in `PersistentMpvSession`, then wiring a 5-second poll in `ink-shell.tsx`. This touches the IPC layer which is sensitive and deserves focused attention.

### Phase 4 — `/tracks` Media Preferences Picker

**Why deferred**: Needs a consolidated picker overlay (or sequential picker flow) for audio track, subtitle track, and quality selection. Audio track switching requires new IPC commands in `PersistentMpvSession`. Best done as a dedicated feature pass.

### Phase 6 — Offline Library Overhaul

**Why deferred**: Largest architectural change. Requires:

- Rich `download-manager-shell.tsx` with metadata, posters, filtering
- New top-level `LibraryPhase` for deep browsing
- Inline `offline` badges in `BrowseShell` results
- History integration for downloaded content

---

## 7. Architecture Guardrails

1. **Screen Purpose Contracts**: Every shell component declares its job-to-be-done
2. **State Rendering Policy**: "Do not repeat the same state in header, badge rows, detail lines, and footer"
3. **Error Surface Routing**: Single `PlaybackErrorPresenter` routes errors to correct screen
4. **Memory-Conscious Refresh**: Event-driven updates, no aggressive polling
5. **Overlay Type Safety**: Always route through `OPEN_OVERLAY` / `OPEN_PICKER`, never mutate search state directly

---

## 8. Related Docs

- `.docs/design-system.md`
- `.docs/ui-redesign-playbook.md`
- `.docs/download-offline-onboarding.md`
- `.plans/cli-ux-overhaul.md`
- `.plans/loading-shell-redesign.md`
- `.plans/fullscreen-root-shell-redesign.md`
