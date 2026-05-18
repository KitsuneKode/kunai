# Post-Playback Fast Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the post-playback menu open immediately after mpv exits, especially on the last episode.

**Architecture:** Post-playback recommendations are non-critical enrichment. The shell should render with prefetched or cached recommendations if available, and never block on a fresh recommendation/catalog call.

**Tech Stack:** `apps/cli/src/app/PlaybackPhase.ts`, `apps/cli/src/app/post-playback-recommendations.ts`, diagnostics.

---

## Agent Tracking Header

```text
SLICE_ID: P8
SLICE_STATUS: planned
SLICE_OWNER: unassigned
SLICE_LAST_UPDATED: 2026-05-18
SLICE_CURRENT_TASK: P8-T1
SLICE_BLOCKERS: none
```

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

- [ ] Add a pure helper that returns prefetched recommendations or an empty list immediately.
- [ ] Add tests for disabled recommendations, prefetched recommendations, and no prefetch.
- [ ] Run `bun run --cwd apps/cli test:unit`.
- [ ] Commit with message `test(playback): cover immediate post-playback recommendation seed`.

### P8-T2: Stop Awaiting Fresh Recommendations Before Shell Open

- [ ] In `PlaybackPhase.ts`, open post-playback with prefetched/cached-only items.
- [ ] Move fresh recommendation warming to non-blocking cache warm if safe.
- [ ] Add diagnostics timing for history save, player release, recommendation seed, and shell open.
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
