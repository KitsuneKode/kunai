---
status: current
lastReviewed: "2026-10-07"
---

# Up Next

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Kunai treats **Up Next** as runtime watch intent, not a durable taste artifact. Some internal modules and storage tables still use `queue` because they predate the product vocabulary lock, but user-facing copy should say Up Next.

Up Next is checkpointed to SQLite so crashes do not silently destroy user intent. On next startup, prior active sessions with pending items are marked recoverable and exposed as a notification.

## Rules

- Up Next recovery never autoplays
- Up Next recovery never silently replaces current playback
- restore is a user action from the inbox
- Up Next items store title identity and provider hints, not stream URLs
- streams are resolved late when playback or download actually needs them

## Placement

Shared media actions support:

- queue next
- queue after current series
- queue at end
- add to Up Next

These actions can be offered from notifications, history, recommendations, search, playlists, and post-playback surfaces without each surface inventing playback-order policy.

The current shell exposes:

- `/up-next`: inspect and manage the current playback order
- `/queue`: compatibility alias for `/up-next`
- `/notifications`: `Enter` restores recoverable Up Next sessions or queues new episode notices
- `/history`: `q` adds the selected history item to Up Next without replacing playback
- search, trending, and recommendation browse rows: `q` adds the highlighted row to Up Next without opening it
- post-playback recommendation rail: `1`, `2`, or `3` **plays** that pick immediately
  (`post-play-view.ts` → `{ type: "recommendation" }`). The shifted variants `!`, `@`, `#`
  open that pick's action menu, which is where adding to Up Next lives
  (`{ type: "recommendation-actions" }`). This doc previously described the shifted
  behaviour against the unshifted keys.
- post-playback recommendation actions: `i` opens details/download actions; download requires confirmation before provider resolution

## Ordering and claims

Explicit reordering does not disable placement actions. Queue next precedes
lower-priority pending rows; after-current-series precedes end placement. Equal
priorities retain insertion order, and existing rows retain their relative order.
An insertion and its position normalization share one SQLite transaction, so a
failed reorder leaves neither a new row nor partially changed positions.

Only pending rows can be selected by `peekNext()`. An in-flight row still counts
as outstanding watch intent for badges, shutdown, and crash recovery; it becomes
pending again on rollback. These rules apply to both anime and TMDB targets and
to every caller of the shared queue service.

## Restore API

Recoverable Up Next sessions can be restored into the current session through the queue service. This operation moves only pending items, closes the old queue session, and leaves playback untouched until the user chooses a play action.

The restore path is intentionally explicit so crash recovery is durable without creating surprise autoplay after restart.

Startup records the owner PID, hostname and process-start identity. The recovery
policy in `apps/cli/src/domain/queue/queue-owner-recovery.ts` retains verified live
siblings and foreign-host owners. A dead local process or a mismatched start
identity can make its pending queue recoverable. An unavailable identity probe
does not prove abandonment; legacy live PIDs remain conservative, while anonymous
or dead legacy owners need an hour of inactivity. The native probe budget is shared
across candidates, and each distinct PID is probed at most once per startup.

Every automatic recovery UPDATE compares the owner fields and last activity that
were observed. A concurrent owner replacement or activity refresh defeats that
write. Restoring also claims a recoverable session inside the transaction, so a
second restore cannot move its rows again. Neither startup nor restore starts a
player. Deterministic policy and SQLite tests cover these decisions; the Linux
integration check additionally uses the real process-start lookup. Windows and
macOS native ownership behavior still requires their platform qualification.
