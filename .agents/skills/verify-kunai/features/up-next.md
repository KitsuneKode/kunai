# Up Next

Up Next is the watch queue: items the user wants to play next, in order.
Queueing is intent to watch; it is not a download and not a playlist.

## Sub-features

- `queue-add` add the selected result from Browse.
- `queue-view` open the Up Next surface.
- `queue-remove` remove an item (double-press confirm), with undo.

## How to get to it (user POV)

- On a Browse result, press `q`.
- Command palette (`/`) → `queue` → Enter opens Up Next.

## Driving it with agent:drive

- **Add.** `bun run agent:drive -- --show frame,queue --keys smoke "<enter>" "<wait:Smoke Movie>" "<down>" q "<wait:Added>"`.
  Frame shows `✓ Added Smoke Series (2026) to Up Next`; the queue table holds
  one `"status": "pending"` row for `tmdb:smoke-series-1`.
- **Remove (the way out).** Continue the plan with
  `"/" "<wait:type a command>" queue "<enter>" "<wait:Up Next>" x "<wait:Press x again>" x "<wait:Removed>"`.
  Frame shows `· Nothing queued` and `removed from queue · z undo`; the queue
  table is `[]`.

## Gotchas

- `x` asks for confirmation; one press only arms it (`Press x again to remove`).
- #691 proposes moving add-to-Up-Next from `q` to `u`. If it lands, this plan
  changes with it.
- Restoring after a restart needs a real relaunch: use the L3 recipe in the
  skill, not L2.
