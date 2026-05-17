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

The inbox is safe to open during playback. It shows local notices and can later route actions through the shared media action router.

Recoverable queue notices are deliberate restore prompts. They should never auto-restore or autoplay on startup.
