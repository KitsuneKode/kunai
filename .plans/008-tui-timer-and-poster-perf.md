# Plan 008: Isolate download status from the root shell

> **Executor instructions**: Recheck the live component and monitor before
> editing. Stop if plan 010's characterization harness still cannot observe the
> root without constructing the full container.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED
- **Category**: performance
- **State**: BLOCKED by the missing `AppRoot` characterization seam in plan 010

## Current truth

The original plan was written before the native poster pipeline and the
event-driven download monitor landed. Its poster capability, external-process,
cache, and polling premises are obsolete and must not be re-executed.

The one verified residue is in
`apps/cli/src/app-shell/ink-shell.tsx`: private `AppRoot` still owns
`downloadStatus`, and updates from `startDownloadStatusMonitor()` therefore
re-render the root shell. The monitor itself already listens for download
changes and has focused coverage in
`apps/cli/test/unit/app-shell/download-status-monitor.test.ts`; do not replace it
with another interval.

## Intended slice after plan 010

1. Add or reuse the plan 010 harness that can count `AppRoot` and leaf commits
   with a controlled container.
2. Capture a failing regression: a download-status update changes only the
   status leaf and does not commit `AppRoot`.
3. Move monitor ownership and its local state into a narrow status component.
   Pass stable services and the minimal playback identity needed to build the
   status line.
4. Preserve the existing event-driven monitor, active-playback wording, and
   root-status debounce behavior.
5. Verify the focused shell tests, then run `bun run test`, `bun run typecheck`,
   and `bun run lint`.

## Done criteria

- A test proves download changes do not re-render `AppRoot`.
- No new poll or duplicate download subscription exists.
- Download status remains correct for queue-only and current-title jobs.
- The root receives a stable leaf/component, not timer-driven state.

## Non-goals

- Poster rendering or capability work (landed in PR #35).
- The wider host/surface split (plan 013).
- Download state-machine changes.
