# Notifications

Kunai notifications are local attention items for new episodes, recoverable queues, downloads, and app notices.

They are not diagnostics. Diagnostics explain technical evidence; notifications are user-facing actions.

## Rules

- notifications never store raw stream URLs, provider headers, cookies, or tokens
- notifications use media identity and provider hints only
- opening the inbox must not stop, replace, or steal active playback
- provider availability sync is experimental and off by default
- muted titles suppress new episode notifications

## Inbox

Use:

```sh
/notifications
/inbox
/alerts
```

The inbox is safe to open during playback. It shows local notices and routes safe actions through the notification/media action routers:

- `Enter` runs the primary action for the selected notice
- `x` dismisses the selected notice
- recoverable queues restore into the current queue session, but do not autoplay
- new episode notices queue by default instead of replacing active playback

Recoverable queue notices are deliberate restore prompts. They should never auto-restore or autoplay on startup.

Queue recovery notices persist only the recoverable queue session id. New episode notices persist media identity and provider hints. Neither path stores stream URLs, headers, cookies, or tokens.
