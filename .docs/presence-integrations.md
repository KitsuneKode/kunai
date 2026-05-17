# Kunai — Presence Integrations

This is the canonical reference for local social presence integrations such as Discord Rich Presence.

## Current State

Presence is implemented as a first-party service seam and is off by default.

| Capability                     | Location                                                | Status      |
| ------------------------------ | ------------------------------------------------------- | ----------- |
| Presence contract              | `apps/cli/src/services/presence/PresenceService.ts`     | Implemented |
| Discord RPC implementation     | `apps/cli/src/services/presence/PresenceServiceImpl.ts` | Implemented |
| Config fields                  | `apps/cli/src/services/persistence/ConfigService.ts`    | Implemented |
| Settings picker for onboarding | `apps/cli/src/app-shell/overlay-panel.tsx`              | Implemented |
| Playback updates               | `apps/cli/src/app/PlaybackPhase.ts`                     | Implemented |
| Shutdown cleanup               | `apps/cli/src/app/SessionController.ts`                 | Implemented |
| Diagnostics snapshot           | `apps/cli/src/app-shell/panel-data.ts`                  | Implemented |

## How Discord Presence Connects

Discord presence is optional and local-only:

1. User sets `presenceProvider` to `discord`.
2. User provides a Discord application client id through `presenceDiscordClientId` or `KUNAI_DISCORD_CLIENT_ID`.
3. The optional `discord-rpc` package must be available at runtime (ships as an optional dependency in the CLI package).
4. Kunai connects through Discord IPC and calls `setActivity` during playback.
5. Playback progress updates provide Discord timestamps while playing. Full privacy also includes
   an exact `position / duration` label in the activity text so the card is readable even when
   Discord chooses to render the timestamp as time remaining. Paused playback uses static
   "Paused at" text so Discord does not show an advancing timer.
6. Full privacy adds provider-safe media facts when the stream inventory exposes them: quality,
   sub/dub presentation, audio language, subtitle language, and subtitle-track count.

If any requirement is missing, Kunai records a diagnostics event and disables automatic retry until
the user reconnects from Settings or changes the presence configuration. This prevents every
playback update from hammering Discord IPC when the desktop app or client id is unavailable.
Elapsed retry windows are allowed to recover from browsing or heartbeat updates, and duplicate
activity payloads are skipped to avoid unnecessary Discord IPC churn.

## Onboarding And Controls

The Settings panel is the user-facing onboarding surface. Open it with `/presence` or `/settings`:

- `Presence` chooses `off` or `discord`.
- `Presence privacy` chooses full title/episode detail or generic private activity.
- `Discord client ID` lets the user type a numeric Discord application client id, clear the
  configured id, or rely on `KUNAI_DISCORD_CLIENT_ID`.
- `Discord open URL` lets the user set or clear an optional safe `https://` or `kunai://` activity
  button URL. Unsafe schemes are rejected by the presence payload builder, and `kunai://` handoffs
  still require local confirmation.
- `Connect Discord now` saves pending settings and verifies local IPC without requiring playback.
- `Disconnect Discord` clears the current activity and closes the local IPC client.

Kunai does not connect to a Discord account directly. Discord Rich Presence uses the already-running
Discord desktop app over local IPC, similar to editor/music-player presence integrations.

## Privacy Rules

Presence integrations must never receive:

- stream URLs
- provider URLs
- request headers
- subtitle URLs
- diagnostics payloads
- local file paths unless the user explicitly opts into that later

`presencePrivacy: "private"` only reports generic Kunai playback. `presencePrivacy: "full"` may include title, episode, mode, provider id, exact playback progress, and provider-safe media facts.

Discord activity buttons are URL-only. Kunai therefore uses a safe project link for the public
button and does not expose stream, subtitle, provider, or local command URLs. An optional
`presenceDiscordOpenUrl` may add an `Open in Kunai` button only when it is an explicit `https://`
or `kunai://` URL. Local protocol handoffs are parsed by `kunai --handoff-url <url>` and always
show a local confirmation picker before taking playback or download action.

## Authentication Model

Discord Rich Presence here is local IPC, not OAuth:

- No browser auth flow
- No access token exchange
- Requires only a Discord application client id + local Discord desktop app IPC
- If client id or IPC is missing, Kunai marks presence unavailable for the process and records diagnostics

## Quick Test Flow

1. Start Discord desktop app.
2. Ensure a client id is available via `presenceDiscordClientId` or `KUNAI_DISCORD_CLIENT_ID`.
3. Upload Discord Developer Portal assets with keys `kunai` and `subtitles` when testing artwork.
4. Set `presenceProvider: "discord"` and preferred `presencePrivacy`.
5. If testing an `Open in Kunai` button, configure `Discord open URL` in `/presence` and inspect
   protocol registration first with `kunai --install-protocol-handler --dry-run`.
6. Start playback in Kunai.
7. Confirm Discord activity updates with the current playback timestamp, exact progress label,
   quality/language facts when available, and safe `Get Kunai` button.
8. If `presenceDiscordOpenUrl` is configured, confirm the `Open in Kunai` button appears only for
   the configured handoff URL and does not include stream, subtitle, provider, header, or file data.
9. For `kunai://` handoffs, register the local handler with `kunai --install-protocol-handler`,
   click the button, and confirm Kunai asks before opening playback or queueing a download.
10. Check `/diagnostics` for presence events.
11. Pause playback and confirm Discord shows a static paused position instead of a moving timer.

## Remaining Work

- Consider optional package installation guidance without making `discord-rpc` a required dependency.
- Upload stable Discord application assets from `apps/cli/assets/discord/` with keys `kunai` and
  `subtitles` in the Discord Developer Portal before treating artwork as guaranteed.
- Keep `presenceDiscordOpenUrl` opt-in until packaged installers can run protocol registration as
  part of installation. Source and global installs can register manually with
  `kunai --install-protocol-handler` on Linux, or inspect the write/command plan first with
  `kunai --install-protocol-handler --dry-run`.

## Related Plan

Implementation polish is tracked in [presence-integrations.md](../.plans/presence-integrations.md).
