# Attention Queue Notifications Audit

Status: action center, playlist exchange, and catalog-new shelf foundation implemented.

## Confirmed Contracts

- Notification, queue, and playlist payloads store media identity and provider hints, not raw stream URLs, headers, cookies, tokens, or local paths.
- Queue recovery is explicit. Startup marks prior active sessions with pending items as recoverable and creates a local notification, but it does not autoplay or replace playback.
- Playlist progress is projected from history instead of copied into durable playlist rows.
- Provider availability sync remains experimental/off by default. The worker is wired as a container service, passes cancellation into supplied refresh callbacks, records runtime diagnostics, and without a refresh callback only plans eligible IDs.
- `/notifications` is available from root, playback, post-playback, and search command contexts without closing mpv playback.
- `/notifications` supports `Enter` for primary actions, `a` for explicit action rows, and `x` to dismiss. Queue recovery restores pending items into the current queue session and leaves playback untouched.
- `/history` and browse recommendation/search rows support `q` to queue the selected item without replacing active playback.
- Post-playback recommendation rail keeps identity-bearing items and supports `1`-`3` to queue visible picks without resolving streams, autoplaying, or leaving the post-playback context.
- `/playlist` can snapshot the runtime queue to a durable playlist and import/export safe Kunai playlist JSON from the playlist exchange folder.
- Browse idle, history, and calendar surface cache-derived `N new` release state without creating provider-confirmed notices or resolving streams.

## Remaining Production Work

- Expand the implemented cached Continue Watching/New Episode surfaces with richer sorting and detail actions; provider availability remains separate and experimental.
- Decide whether post-playback recommendation rows should later expose download/detail actions; queue is implemented, but download should wait for a shared confirmation path so it does not surprise-resolve providers from the rail.
- Add manual smoke for queue recovery, browse queueing, provider availability dry-run, and playlist export before release.

## Risk Notes

- The storage schema is additive. Existing JSON config/provider stores remain untouched.
- Provider availability worker integration should still avoid real provider calls by default; a future callback must remain budgeted and cancellable.
