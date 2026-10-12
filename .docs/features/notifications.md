---
status: current
lastReviewed: "2026-10-12"
---

# Notifications

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Kunai notifications are local attention items for new episodes, recoverable queues, downloads, and app notices.

They are not diagnostics. Diagnostics explain technical evidence; notifications are user-facing actions.

## Rules

- notifications never store raw stream URLs, provider headers, cookies, or tokens
- notifications use media identity and provider hints only
- opening the inbox must not stop, replace, or steal active playback
- provider availability sync is experimental and off by default
- muted titles suppress new episode notifications
- clearing the Archive permanently suppresses those exact notification identities,
  just like individual deletion; repeated reconciliation cannot recreate them
- archive clearing preserves active notices and allows newer episode identities;
  suppression and deletion commit together or both roll back

## Inbox

Use:

```sh
/notifications
/inbox
/alerts
```

The inbox is safe to open during playback. It shows local notices and routes safe actions through the notification/media action routers:

- `Enter` runs the primary action for the selected notice
- `a` opens the explicit action menu for the selected notice
- `x` dismisses the selected notice
- recoverable queues restore into the current queue session, but do not autoplay
- new episode notices queue by default instead of replacing active playback

### Play now

`Enter` on a notice carrying a playable target — an episode identity, or a
movie identity — runs `play-now`: it launches the announced episode through
the normal playback intent/phase loop rather than a parallel path. Anime
notices carry `absoluteEpisode` and play that episode; series notices carry
`season`/`episode`. A notice with only title identity leads with
`open-details` (the details/search path) instead of a dead play, and a notice
with no media identity offers no play action at all.

Both open routes deliver the intent: through the awaited
`openNotificationsOverlay()` the row resolves the overlay bridge and the
opener returns a `history-entry` result; through a direct `OPEN_OVERLAY`
dispatch the row executor self-delivers — a retained browse or post-play
session settles with `launch-playback`, and a live or resolving playback
session receives a stop-backed `switch-title` intent consumed after the
stop/resolve abort. When playback is active, `play-now` asks for
confirmation before switching titles. If nothing can take the launch — no
browse, post-play, or playback surface — the row reports that instead of
silently dropping the intent.

Recoverable queue notices are deliberate restore prompts. They should never auto-restore or autoplay on startup.

Queue recovery notices persist only the recoverable queue session id. New episode notices persist media identity and provider hints — including `contentType`, `externalIds`, and `absoluteEpisode` for anime — so the stored row replays the same launch the signal described. Neither path stores stream URLs, headers, cookies, or tokens.
