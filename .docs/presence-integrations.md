# Kunai — Presence Integrations

This is the canonical reference for local social presence integrations such as Discord Rich Presence.

## Current State

Presence is implemented as a first-party service seam and is off by default.

| Capability                           | Location                                                | Status      |
| ------------------------------------ | ------------------------------------------------------- | ----------- |
| Presence contract                    | `apps/cli/src/services/presence/PresenceService.ts`     | Implemented |
| Discord RPC implementation           | `apps/cli/src/services/presence/PresenceServiceImpl.ts` | Implemented |
| Config fields                        | `apps/cli/src/services/persistence/ConfigService.ts`    | Implemented |
| Settings picker for provider/privacy | `apps/cli/src/app-shell/overlay-panel.tsx`              | Implemented |
| Playback updates                     | `apps/cli/src/app/PlaybackPhase.ts`                     | Implemented |
| Shutdown cleanup                     | `apps/cli/src/app/SessionController.ts`                 | Implemented |

## How Discord Presence Connects

Discord presence is optional and local-only:

1. User sets `presenceProvider` to `discord`.
2. User provides a Discord application client id through `presenceDiscordClientId` or `KUNAI_DISCORD_CLIENT_ID`.
3. The optional `discord-rpc` package must be available at runtime (ships as an optional dependency in the CLI package).
4. Kunai connects through Discord IPC and calls `setActivity` during playback.

If any requirement is missing, Kunai records a diagnostics event and disables retry for the rest of the process.

## Privacy Rules

Presence integrations must never receive:

- stream URLs
- provider URLs
- request headers
- subtitle URLs
- diagnostics payloads
- local file paths unless the user explicitly opts into that later

`presencePrivacy: "private"` only reports generic Kunai playback. `presencePrivacy: "full"` may include title, episode, mode, and provider id.

## Authentication Model

Discord Rich Presence here is local IPC, not OAuth:

- No browser auth flow
- No access token exchange
- Requires only a Discord application client id + local Discord desktop app IPC
- If client id or IPC is missing, Kunai marks presence unavailable for the process and records diagnostics

## Quick Test Flow

1. Start Discord desktop app.
2. Ensure a client id is available via `presenceDiscordClientId` or `KUNAI_DISCORD_CLIENT_ID`.
3. Set `presenceProvider: "discord"` and preferred `presencePrivacy`.
4. Start playback in Kunai.
5. Confirm Discord activity updates and check `/diagnostics` for presence events.

## Remaining Work

- Add a first-run/setup path or settings input for `presenceDiscordClientId`.
- Add command/help text that explains why Discord may be unavailable.
- Consider optional package installation guidance without making `discord-rpc` a required dependency.
- Add richer activity assets only after stable Discord application assets exist.

## Related Plan

Implementation polish is tracked in [presence-integrations.md](../.plans/presence-integrations.md).
