---
status: current
lastReviewed: "2026-10-03"
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

The overlay labels the first pending row **up next**, and an in-flight claim
**starting**. Neither proves that the player began. The queue records a row as
played only after confirmed playback startup; that record means the intent was
consumed, not that the video finished. Current playback must come from the
player lifecycle, never from the first unplayed row or a VLC handoff return code.

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
