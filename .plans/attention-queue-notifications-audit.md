# Attention Queue Notifications Audit

Status: action center and playlist exchange foundation implemented.

## Confirmed Contracts

- Notification, queue, and playlist payloads store media identity and provider hints, not raw stream URLs, headers, cookies, tokens, or local paths.
- Queue recovery is explicit. Startup marks prior active sessions with pending items as recoverable and creates a local notification, but it does not autoplay or replace playback.
- Playlist progress is projected from history instead of copied into durable playlist rows.
- Provider availability sync remains experimental/off by default. The worker is wired as a container service, passes cancellation into supplied refresh callbacks, records runtime diagnostics, and without a refresh callback only plans eligible IDs.
- `/notifications` is available from root, playback, post-playback, and search command contexts without closing mpv playback.
- `/notifications` supports `Enter` for primary actions, `a` for explicit action rows, and `x` to dismiss. Queue recovery restores pending items into the current queue session and leaves playback untouched.
- `/history` and browse recommendation/search rows support `q` to queue the selected item without replacing active playback.
- `/playlist` can snapshot the runtime queue to a durable playlist and import/export safe Kunai playlist JSON from the playlist exchange folder.

## Remaining Production Work

- Add visible Continue Watching/New Episode shelves using cached projections first, then provider availability only inside the experimental budget.
- Add richer post-playback recommendation cards that expose queue/download actions directly instead of requiring `/recommendation`.
- Add manual smoke for queue recovery, browse queueing, provider availability dry-run, and playlist export before release.

## Risk Notes

- The storage schema is additive. Existing JSON config/provider stores remain untouched.
- Provider availability worker integration should still avoid real provider calls by default; a future callback must remain budgeted and cancellable.
