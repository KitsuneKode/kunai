# Up Next and queue

Users queue watch intent, reorder or remove items, and expect relaunch plus explicit restore to retain pending rows without double-consuming retries.

## Sub-features

- `enqueue` adds the intended title/episode to SQLite queue.
- `relaunch-retain` keeps queue rows after real quit/reboot (L3).
- `explicit-restore` applies queued intent after restart without silent drop.
- `remove-confirm` two-step remove prevents accidental deletion.

## How to get to it (user POV)

- From browse or post-play, use queue/`q` shortcuts as advertised.
- Command palette → queue / Up Next surfaces when enabled.

## Driving it with verify-kunai

Preconditions:

- L3 tmux session (`agent:session`) for relaunch semantics; L2 for single-shot enqueue inspect.

- **Enqueue + relaunch (L3).** Follow the queue recipe in `SKILL.md` (`q1` session): enqueue, `inspect queue`, relaunch, palette restore, confirm row persists.
- **Backend witness.** `inspect queue` or `--show queue` must match frame identity (title id, episode).
- **Reverse: failed startup** rolls back claim — inspect `last_failure_json` when simulating failure paths in integration tests.

## Gotchas

- Queue (watch intent) ≠ downloads (acquisition jobs) ≠ playlists — verify the feature you changed.
- Remove is two-press on many surfaces; one Esc does not prove deletion.
