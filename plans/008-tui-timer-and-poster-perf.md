# Plan 008: Stop whole-tree re-renders from timers and stop poster-cache thrash on navigation

> **Executor instructions**: Follow step by step; verify each step; STOP on any
> STOP condition; update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- apps/cli/src/app-shell/ink-shell.tsx apps/cli/src/app-shell/image-pane.ts apps/cli/src/app-shell/use-poster-preview.ts apps/cli/src/image/capability.ts apps/cli/src/services/download/DownloadService.ts`
> Mismatch vs excerpts → STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

Three concrete sources of TUI jank on hot paths:

1. **Timer ticks re-render the whole 2,102-line root shell.** A 1s telemetry interval and a 2s download-status interval both `setState` on `ink-shell.tsx` (26 `useState` at the root), forcing a full reconcile of the entire shell subtree every second during playback and every 2s for the whole session.
2. **The 2s download poll runs two SQLite queries forever, even with zero downloads and the surface hidden.**
3. **Every poster navigation wipes the 64-entry poster cache it just built,** forcing chafa re-spawn / Kitty re-upload when you step back to a poster seen moments ago — plus image-capability detection re-runs `Bun.which` uncached on the nav path.

Fixing these makes navigation and playback feel smooth and stops steady background work that never idles.

## Current state

### Root-shell timers — `apps/cli/src/app-shell/ink-shell.tsx`

Download-status poll at `:619-646`:

```ts
useEffect(() => {
  const resolveStatus = () => {
    const snapshot = stateManager.getState();
    const currentTitle = snapshot.currentTitle;
    if (!currentTitle) {
      setDownloadStatus(container.downloadService.describeQueueSummary());
      return;
    }
    // …describeActiveDownloadForPlayback…
  };
  resolveStatus();
  const timer = setInterval(resolveStatus, 2000); // runs whole session
  return () => clearInterval(timer);
}, [container.downloadService, stateManager /* … */]);
```

Telemetry poll at `:651-663`:

```ts
useEffect(() => {
  if (!playbackIsActive) return;
  const refreshSnapshot = () =>
    setPlaybackTelemetrySnapshot(container.playerControl.getTelemetrySnapshot());
  refreshSnapshot();
  const timer = setInterval(refreshSnapshot, 1_000); // whole-tree setState every 1s during playback
  return () => clearInterval(timer);
}, [container.playerControl, playbackIsActive]);
```

`describeQueueSummary` issues `listActive(120)` + `listFailed(20)` SQLite queries every call (`DownloadService.ts:357-358`); `hasActiveJobs()` already exists (`DownloadService.ts:371`).

### Poster cache — `apps/cli/src/app-shell/image-pane.ts:10-30`

```ts
const posterCache = new Map<string, PosterResult>(); // MAX_CACHE = 64
export function clearRenderedPosterImages(): void {
  deleteAllTerminalImages();
  posterCache.clear(); // <-- flushes the whole render cache
  posterInflight.clear();
}
```

Called on every URL/enable change from `use-poster-preview.ts:71,77` for callers with the default `preserveTerminalImages: false` (ink-shell, MediaPanel, detail/overlay panes). `MiniPosterTile` passes `preserveTerminalImages: true` and is already fine.

### Capability detection — `apps/cli/src/image/capability.ts:69,73`

```ts
export function isChafaAvailable(): boolean {
  return Boolean(runtime.which("chafa"));
} // Bun.which every call
export function detectImageCapability(env = process.env): ImageCapability {
  /* recomputes every call */
}
```

Repo conventions: memoized row models + `React.memo` are the established fix pattern (see the calendar fix in `browse-shell.tsx` windowing at `:839-841` and its `useMemo` at `:855`); rule of thumb — never drive Kitty writes from a nav hot path. Conventional commits.

## Commands you will need

| Purpose      | Command                                   | Expected                          |
| ------------ | ----------------------------------------- | --------------------------------- |
| Typecheck    | `bun run typecheck`                       | exit 0                            |
| Lint         | `bun run lint`                            | exit 0                            |
| One file     | `cd apps/cli && bun run test:file <path>` | pass                              |
| CLI tests    | `bun run --cwd apps/cli test`             | pass                              |
| Manual smoke | `bun run dev`                             | poster nav + playback feel smooth |

## Scope

**In scope**:

- `apps/cli/src/image/capability.ts` (memoize)
- `apps/cli/src/app-shell/image-pane.ts` (separate undisplay from cache eviction)
- `apps/cli/src/app-shell/use-poster-preview.ts` (call the narrower undisplay)
- `apps/cli/src/app-shell/ink-shell.tsx` (gate the download poll; isolate timer state into leaf components)
- New small components for the status line / telemetry line if extracted
- Tests under `apps/cli/test/unit/`

**Out of scope**:

- The broader ink-shell host/surface split (plan 013) — here only isolate the two timer-driven state slices, don't restructure the file.
- `MiniPosterTile` (already correct).
- Changing the telemetry/download data itself — only _where_ it re-renders.

## Git workflow

- Branch: `advisor/008-tui-timer-and-poster-perf`
- Commits: one per concern (`perf(image): memoize capability detection`, `perf(image): keep poster cache resident across nav`, `perf(shell): isolate timer-driven state from the root tree`, `perf(shell): gate download poll on active jobs`)

## Steps

### Step 1: Memoize image-capability detection

Compute `detectImageCapability()` once per process and cache it (keyed by the small set of relevant env vars it reads: `KUNAI_POSTER`, `KUNAI_IMAGE_PROTOCOL`, terminal identity — all fixed at launch). Memoize `isChafaAvailable`'s `Bun.which` result. Keep the injectable `runtime.which` seam intact for tests (reset the memo in a test hook).

**Verify**: `bun run typecheck` → exit 0; existing capability tests pass (`ls apps/cli/test -R | grep -i capab`).

### Step 2: Separate "undisplay current image" from "evict cache"

Split `clearRenderedPosterImages` into two: one that only issues the Kitty delete for images no longer on screen (`deleteAllTerminalImages` or a narrower per-id delete), and one that evicts the in-memory `posterCache`. Update `use-poster-preview.ts:71,77` to call only the undisplay variant on nav, keeping `posterCache`/`posterInflight` resident so a revisited poster is served from cache. Preserve `deleteAllKittyImages()`'s full-clear behavior for actual teardown (`image-pane.ts:21-24`).

**Verify**: `bun run typecheck` → exit 0. Manual: `bun run dev`, navigate a poster list forward and back — the revisited poster should not visibly re-render from scratch.

### Step 3: Gate the download poll on active jobs

In the `:619` effect, do not run the 2s interval when there are no active jobs. Use `container.downloadService.hasActiveJobs()` (exists at `DownloadService.ts:371`) to decide, or subscribe to a download-change signal if one exists (`grep -n "subscribe\|emitChange\|onChange" apps/cli/src/services/download/DownloadService.ts`). When idle, set the status once and don't poll. Restart polling when a job becomes active.

**Verify**: `bun run typecheck` → exit 0.

### Step 4: Isolate the two timer-driven state slices

Move `downloadStatus` and `playbackTelemetrySnapshot` out of the root component into small dedicated child components (e.g. `<DownloadStatusLine />`, `<PlaybackTelemetryLine />`) that own their own interval + `useState`, so a tick re-renders only that line, not the 2,100-line tree. Pass them the `container`/`stateManager` they need as props. Do NOT lift any other root state; keep the change surgical.

**Verify**: `bun run --cwd apps/cli test` → pass (shell input/render tests still green — `test/unit/app-shell/`).

### Step 5: Tests

- Capability memoization: `detectImageCapability` calls `runtime.which` at most once across N calls (spy).
- Poster cache: after an undisplay-on-nav, a subsequent `fetchPoster` for the same URL is served from cache (no new render) — assert against the cache map or a fetch spy.
- Download poll gating: with `hasActiveJobs() === false`, the interval does not fire repeated `describeQueueSummary` calls (spy count stays at the single initial call).

Model after existing `apps/cli/test/unit/app-shell/*` and image tests.

**Verify**: run the new test files → pass.

### Step 6: Full gates + manual smoke

**Verify**: `bun run typecheck && bun run lint && bun run --cwd apps/cli test` → all exit 0. `bun run dev`: poster nav feels smooth; during playback the shell isn't visibly re-rendering the whole frame each second.

## Done criteria

- [ ] `bun run typecheck`, `bun run lint` exit 0; CLI tests pass
- [ ] `detectImageCapability`/`isChafaAvailable` memoized (test proves single `which`)
- [ ] Poster cache stays resident across nav (test proves cache hit on revisit)
- [ ] Download poll does not run when `hasActiveJobs()` is false (test proves it)
- [ ] `downloadStatus` and `playbackTelemetrySnapshot` live in leaf components, not the root (grep shows their `useState` moved out of the top-level shell component)
- [ ] No files outside scope modified; `plans/README.md` row updated

## STOP conditions

- Extracting the telemetry/status lines into children requires threading more than 3–4 props or lifting other state — stop at gating + memoization and report the coupling (that's plan 013's job).
- The poster cache split causes visible flicker (an on-screen image gets deleted that shouldn't) — revert Step 2 and report; correctness beats the cache win.
- `hasActiveJobs()` doesn't reflect queued-but-not-started jobs and gating hides a real active download — report.

## Maintenance notes

- Interacts with plan 013 (ink-shell split): the extracted leaf components are a down payment on that split — name/locate them so 013 can absorb them.
- Reviewer: confirm no on-screen poster is ever deleted by the narrower undisplay (the split's one real risk).
- The "never drive Kitty placements from a nav hot path" rule applies to any future poster surface — reuse `MiniPosterTile`'s `preserveTerminalImages: true` + selected-only fetch pattern.
