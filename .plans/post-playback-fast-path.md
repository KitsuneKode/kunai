# Post-Playback Fast Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the post-playback menu open immediately after mpv exits, especially on the last episode.

**Architecture:** Post-playback recommendations are non-critical enrichment. The shell should render with prefetched or cached recommendations if available, and never block on a fresh recommendation/catalog call.

**Tech Stack:** `apps/cli/src/app/PlaybackPhase.ts`, `apps/cli/src/app/post-playback-recommendations.ts`, diagnostics.

---

## Agent Tracking Header

```text
SLICE_ID: P8
SLICE_STATUS: complete
SLICE_OWNER: codex
SLICE_LAST_UPDATED: 2026-06-13
SLICE_CURRENT_TASK: complete
SLICE_BLOCKERS: none
```

> **Completed 2026-06-13.** Root cause of the from-history lag confirmed: when the
> synchronous recommendation seed is empty (nothing prefetched — the from-history
> case), the post-play loop awaited a fresh recommendation fetch before first
> paint. Fix: `resolvePostPlaybackRecommendationLoadMode` — only **block** when an
> auto-continue into the top recommendation is reachable (end of series,
> autoplay-recs on); otherwise load in the **background** so the menu paints
> instantly and the rail fills on a later loop iteration. The bounded budget
> (now 250 ms) only applies to the rare block path. Decision logic is unit-tested.

## File Ownership

Modify:

- `apps/cli/src/app/PlaybackPhase.ts`
- `apps/cli/src/app/post-playback-recommendations.ts`
- `apps/cli/test/unit/app/post-playback-recommendations.test.ts`
- diagnostics tests only if timing spans are added.

Do not change provider resolution in this slice.

## Current Risk

When there is no next episode, recommendation prefetch may not have happened. If post-playback then awaits recommendation loading before opening the shell, the user sees a long blank/loading gap after mpv closes.

## Tasks

### P8-T1: Add Non-Blocking Recommendation Seed Helper

- [x] Add a pure helper that returns prefetched recommendations or an empty list immediately.
- [x] Add tests for disabled recommendations, prefetched recommendations, and no prefetch.
- [ ] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `test(playback): cover immediate post-playback recommendation seed`.

### P8-T2: Stop Awaiting Fresh Recommendations Before Shell Open

- [x] In `PlaybackPhase.ts`, open post-playback with prefetched/cached-only items.
- [x] Move fresh recommendation warming to non-blocking cache warm if safe.
- [x] Add diagnostics timing for recommendation seed/warm and auto-next prefetch grace.
- [ ] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `fix(playback): open post-playback menu without recommendation wait`.

## Stop Conditions

- Stop if the shell API requires blocking network recommendations to render.
- Stop if background warming can mutate UI state unsafely.
- Stop if player release itself is the real bottleneck; report timing evidence.

## Acceptance Tests

- Last episode end opens post-playback without waiting for a fresh recommendation request.
- Existing prefetched recommendations still show.
- Recommendation failure does not delay or break post-playback actions.
