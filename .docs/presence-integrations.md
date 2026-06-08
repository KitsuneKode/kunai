# Kunai — Presence Integrations

This is the canonical reference for local social presence integrations such as Discord Rich Presence.

## Current State

Presence is implemented as a first-party service seam and is off by default.

| Capability                     | Location                                               | Status      |
| ------------------------------ | ------------------------------------------------------ | ----------- |
| Presence contract              | `apps/cli/src/services/presence/PresenceService.ts`    | Implemented |
| Discord IPC implementation     | `apps/cli/src/services/presence/discord-ipc-client.ts` | Implemented |
| Config fields                  | `apps/cli/src/services/persistence/ConfigService.ts`   | Implemented |
| Settings picker for onboarding | `apps/cli/src/app-shell/overlay-panel.tsx`             | Implemented |
| Playback updates               | `apps/cli/src/app/PlaybackPhase.ts`                    | Implemented |
| Shutdown cleanup               | `apps/cli/src/app/SessionController.ts`                | Implemented |
| Diagnostics snapshot           | `apps/cli/src/app-shell/panel-data.ts`                 | Implemented |

## How Discord Presence Connects

Discord presence is optional and local-only:

1. User sets `presenceProvider` to `discord`.
2. User provides a Discord application client id through `presenceDiscordClientId` or `KUNAI_DISCORD_CLIENT_ID`.
3. Kunai connects through Discord's local IPC pipe/socket from Bun and sends `SET_ACTIVITY`
   frames directly.
4. While playing, playback progress uses Discord `timestamps.start` + `timestamps.end` for a
   Cider-style progress bar once mpv reports a duration. Full privacy also includes an exact
   `position / duration` label in `state` for clients that render time remaining differently.
5. Paused playback sends `timestamps: null` with static `Paused at …` text so Discord does not
   keep advancing the old timer. After three minutes paused (tunable), Kunai clears the activity.
6. Full privacy adds safe poster artwork and catalog links when ids are known.

If any requirement is missing, Kunai records a diagnostics event and disables automatic retry until
the user reconnects from Settings or changes the presence configuration. Duplicate activity payloads
are skipped to avoid unnecessary Discord IPC churn.

## Lifecycle

| Event                                        | Presence behavior                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Playback starts                              | Show episode card; start internal binge session clock                                 |
| Progress updates                             | Refresh timestamps/progress when duration is known                                    |
| Pause                                        | Static paused card; schedule clear after `presencePausedClearDelayMs` (default 3 min) |
| Resume                                       | Cancel pause clear timer; resume playing card                                         |
| Autoplay next episode                        | Keep presence and binge session clock (no flash clear)                                |
| Post-play idle (mpv closed, up-next overlay) | `clearPlayback("playback-idle")`                                                      |
| Leave playback phase                         | `clearPlayback("playback-exited")`                                                    |
| Quit / shutdown                              | `presence.shutdown()`                                                                 |

Kunai no longer replaces finished playback with a generic "Browsing Kunai" activity.

## Binge session indicator

Discord exposes only one timestamp pair per activity, so episode progress and a separate session
elapsed line cannot both use native Discord timers.

Kunai tracks continuous watch time internally across autoplay episodes (pause time excluded). After
`presenceSessionShowAfterMs` (default 15 minutes), full-privacy `state` gains a suffix such as
`· 45m with Kunai`. The suffix is hidden while paused and resets when presence clears.

Tuning env keys:

- `KUNAI_TUNING_PRESENCE_PAUSED_CLEAR_DELAY_MS` (default `180000`)
- `KUNAI_TUNING_PRESENCE_SESSION_SHOW_AFTER_MS` (default `900000`)

## Onboarding And Controls

The Settings panel is the user-facing onboarding surface. Open it with `/presence` or `/settings`:

- `Presence` chooses `off` or `discord`.
- `Presence privacy` chooses full title/episode detail or generic private activity.
- `Discord client ID` lets the user type a numeric Discord application client id, clear the
  configured id, or rely on `KUNAI_DISCORD_CLIENT_ID`.
- `Discord open URL` lets the user set or clear a reserved safe `https://` or `kunai://` handoff
  URL for future Discord buttons. The current activity payload ignores it and builds catalog
  buttons from title ids instead.
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

`presencePrivacy: "private"` only reports generic Kunai playback and the bundled Kunai asset.
`presencePrivacy: "full"` may include title, episode, catalog ids, playback timestamps, and safe
poster artwork.

Discord activity buttons are URL-only (max two). During full privacy playback Kunai adds a single
catalog button when ids are known:

- **View episode on TMDB** for TV with a TMDB id
- otherwise **View on AniList**, **View on IMDb**, or **View on TMDB** for the series/movie

Recent Discord clients also support clickable text/image via `details_url`, `state_url`, and
`assets.large_url` when catalog ids are known.

Play-in-Kunai handoffs are intentionally deferred. `presenceDiscordOpenUrl` remains in settings
for future use but is not wired into the default activity payload.

Full privacy cards are laid out like music-player presence (Cider-style): show title on
`details`, `S# E# · episode name` on `state`, playback progress via Discord timestamps, and the
show poster as `assets.large_image` when a safe `https://` poster URL is available on the title,
title artwork, or episode artwork (fallback asset key `kunai`). Provider stream URLs, subtitle URLs,
headers, and local paths stay out of Discord payloads.

Upload portal assets from `apps/cli/assets/discord/` with keys `kunai` and `subtitles` for the
fallback artwork. Without portal upload, Discord shows a generic placeholder when no HTTPS poster
URL is available.

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
5. Start playback in Kunai.
6. Confirm Discord activity shows poster (or uploaded `kunai` fallback), `S# E# · episode`,
   progress bar after duration is known, clickable catalog URLs, and a catalog button when ids exist.
7. Pause → static card, no advancing timer; after ~3 minutes → presence clears.
8. Autoplay next episode → card updates without clearing binge session suffix (after 15+ minutes).
9. Return to search / quit → presence clears.
10. Check `/diagnostics` for presence events.

## Remaining Work

- Keep the Bun-native IPC client covered by unit tests because it owns Discord transport behavior.
- Upload stable Discord application assets from `apps/cli/assets/discord/` with keys `kunai` and
  `subtitles` in the Discord Developer Portal before treating artwork as guaranteed.
- Keep `presenceDiscordOpenUrl` opt-in until packaged installers can run protocol registration as
  part of installation.

## Related Plan

Implementation polish is tracked in [presence-integrations.md](../.plans/presence-integrations.md).
