---
status: current
lastReviewed: "2026-09-30"
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

Recoverable queue notices are deliberate restore prompts. They should never auto-restore or autoplay on startup.

Queue recovery notices persist only the recoverable queue session id. New episode notices persist media identity and provider hints. Neither path stores stream URLs, headers, cookies, or tokens.

## Desktop delivery

`OsNotificationSink` (`apps/cli/src/services/notifications/notification-sinks.ts`) pops real OS
notifications beside the durable inbox:

- **Linux:** `notify-send` argv-only — no shell, title/body are positional args.
- **macOS:** `osascript` with a fixed `on run argv` script — title/body travel as argv items,
  never as AppleScript source.
- **Windows:** `powershell -EncodedCommand` with a fixed WinRT toast script — title/body travel as
  `KUNAI_NOTIFY_*` env vars, never as script source. The toast uses the well-known Windows
  PowerShell AUMID so no helper binary or BurntToast install is needed.

Delivery is best-effort and bounded:

- `KUNAI_DESKTOP_NOTIFICATIONS=0|false|no|off` disables it (default on); the inbox is unaffected.
- A missing notifier binary or an unsupported platform means no popup — never an error.
- `NotificationService` replays the whole active set on every mutation, so the sink dedupes by
  `dedupKey` (re-armed on `dismiss`, capped at 500 remembered keys) and ignores records created
  before the process started, so launching Kunai does not re-pop the inbox.
- Each notifier subprocess gets ignored stdio and a 5-second reaper; spawn failures, rejected
  `exited` promises, and hung processes are all swallowed. Nothing in delivery can block or
  crash the shell.

The subprocess runtime (`platform`, `which`, `spawn`) is injected for deterministic tests,
matching the seam in `infra/os/external-open.ts`.
