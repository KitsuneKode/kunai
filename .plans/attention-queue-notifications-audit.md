# Attention Queue Notifications Audit

Status: actionable inbox foundation implemented.

## Confirmed Contracts

- Notification, queue, and playlist payloads store media identity and provider hints, not raw stream URLs, headers, cookies, tokens, or local paths.
- Queue recovery is explicit. Startup marks prior active sessions with pending items as recoverable and creates a local notification, but it does not autoplay or replace playback.
- Playlist progress is projected from history instead of copied into durable playlist rows.
- Provider availability sync remains experimental/off by default. The worker is wired as a container service, but without a refresh callback it only plans eligible IDs and performs no provider calls.
- `/notifications` is available from root, playback, post-playback, and search command contexts without closing mpv playback.
- `/notifications` supports `Enter` for primary actions and `x` to dismiss. Queue recovery restores pending items into the current queue session and leaves playback untouched.
- `/history` supports `q` to queue the selected history item without replacing active playback.

## Remaining Production Work

- Add secondary action menus for inbox rows so queue-next, queue-end, download, open details, and dismiss can be selected explicitly instead of relying on the primary action.
- Wire `MediaActionRouter` into recommendations, search rows, and post-playback recommendation rows instead of only history and notifications.
- Add visible Continue Watching/New Episode shelves using cached projections first, then provider availability only inside the experimental budget.
- Add import/export shell workflows for durable playlists.
- Add manual smoke for queue recovery and playlist export before release.

## Risk Notes

- The storage schema is additive. Existing JSON config/provider stores remain untouched.
- The current inbox is deliberately conservative; it renders notices and keeps context safe, but it is not yet a full action center.
- Provider availability worker integration should not execute provider calls until it has cancellation, budget telemetry, diagnostics, and no-N+1 tests around the supplied refresh callback.
