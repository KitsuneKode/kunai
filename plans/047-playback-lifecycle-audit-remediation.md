# Plan 047: Make playback, queue interruption, and one-shot ownership truthful

> **For executors:** use test-driven development and verification before
> completion. Work against current `PlaybackPhase.ts`; do not import unrelated
> local playback/prefetch edits from another worktree.

## Goal

Close the three remaining playback-lifecycle findings without widening the
player architecture:

- **K-06:** session phase becomes `playing` only on confirmed
  `playback-started`, not before `playStream()` is invoked.
- **K-11:** an explicit high-priority “play next” queue row interrupts the
  catalog episode chain before its countdown begins.
- **K-13:** if one-shot mpv IPC bootstrap fails, Kunai terminates the process it
  spawned before returning failure.

## Verified current state

- `PlaybackPhase.ts` dispatches the session `playback-started` transition before
  calling `playStream()`. Queue acknowledgement itself is correctly attached to
  `runMpvPlaybackSession.onConfirmedPlaybackStart`.
- `planCatalogAutoAdvance()` is called with `queueHead: undefined`; its episode
  countdown and `continue` run before `planPlaylistAutoAdvance()` reads the real
  queue head. The pure `resolveNextUp()` policy is correct, but the caller order
  bypasses it.
- The one-shot path must be re-read from `PlayerServiceImpl` through `mpv.ts`.
  The fix owns only the child created by that attempt; it must not kill a newer
  persistent generation.

## Task 1 — confirmed playback phase

1. Add a failing session/phase test proving resolve and stream preparation stop
   at `ready`/launching until a `playback-started` event arrives.
2. Remove the pre-launch `playback-started` transition.
3. Transition the session from the existing confirmed-start callback, exactly
   once per generation.
4. Preserve queue acknowledgement at the same callback and preserve pre-start
   rollback for launch failure/cancellation.

## Task 2 — interrupting queue precedence

1. Add a regression test with a catalog next episode plus a queue head at
   `INTERRUPTING_QUEUE_PRIORITY`; assert no catalog countdown/navigation occurs
   and the exact queue row is claimed.
2. Read the queue head once for the decision and pass it into the first
   `resolveNextUp` evaluation. Do not substitute a later/reordered head.
3. Keep ordinary low-priority queue rows behind the catalog episode chain.
4. Keep recommendation precedence unchanged.

## Task 3 — one-shot bootstrap ownership

1. Extend the fake mpv/process harness so IPC connection/bootstrap can fail
   after spawn.
2. Assert the owned child is terminated and awaited/reaped before failure
   returns, active control is cleared only for that generation, and no second
   player is harmed.
3. Implement cleanup in the narrow owner that has both the child handle and the
   bootstrap failure. Cleanup must also run on cancellation.

## Verification

```sh
bun run --cwd apps/cli test -- test/unit/app/playback test/unit/infra/player test/integration/queue-playback-lifecycle.test.ts
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
```

The compiled playback smoke and Windows parity job are release gates for this
plan because process and IPC behavior differs by platform.

## Stop conditions

- The only apparent fix acknowledges queue playback on process spawn or IPC
  connection rather than confirmed progress.
- Cleanup cannot prove which generation owns the child.
- The queue fix would require reviving deprecated `QueueService.advance()`.

Status: TODO
