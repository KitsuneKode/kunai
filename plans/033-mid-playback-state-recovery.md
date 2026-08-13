# Plan 033: Restore truthful playback state after buffering and stalls

> **Drift check:** `git diff --stat 36da54c4..HEAD -- apps/cli/src/app/playback/run-mpv-playback-session.ts apps/cli/test/unit/app`

**Goal:** Once mpv resumes producing progress, Kunai must leave stale
`buffering`/`stalled`/`seeking` UI states immediately without restarting playback.

## Status

- **Priority:** P1
- **Effort:** S
- **Risk:** LOW
- **Planned at:** `36da54c4`, 2026-08-11

## Defect

`run-mpv-playback-session.ts:212-250` enters buffering, stalled, and seeking states,
but `playback-progress` only updates presence. A recovered stream can therefore keep
displaying a failure state while video is playing normally.

## Tasks

- [ ] Add a table-driven event-sequence test for
  `started -> buffering -> progress`, `started -> stalled -> progress`,
  `started -> seeking -> progress`, pause/resume, and repeated progress.
- [ ] Extract a small pure playback-status reducer used by the event callback. Treat
  valid forward progress as `playing` unless the player is explicitly paused.
- [ ] Avoid emitting duplicate status writes when the state does not change.
- [ ] Clear stale warning copy when recovery is confirmed, while retaining the event
  in diagnostics.
- [ ] Add one render-capture sequence proving the Now Playing surface changes back to
  playing without an extra keypress.

## Verification

```sh
bun run --cwd apps/cli test:file test/unit/app/run-mpv-playback-session.test.ts
bun run typecheck
bun run lint
bun run fmt:check
bun run test
```

Do not change mpv reconnect budgets in this slice; state truth and network policy are
separate concerns.
