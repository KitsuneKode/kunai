---
status: current
lastReviewed: "2026-08-23"
---

# Kunai — Presence Integrations

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

This is the canonical reference for local social presence integrations such as Discord Rich Presence.

## Current State

Presence is implemented as a first-party service seam and is off by default.

| Capability                  | Location                                               | Status      |
| --------------------------- | ------------------------------------------------------ | ----------- |
| Presence contract           | `apps/cli/src/services/presence/PresenceService.ts`    | Implemented |
| Discord IPC implementation  | `apps/cli/src/services/presence/discord-ipc-client.ts` | Implemented |
| Config fields               | `apps/cli/src/services/persistence/ConfigService.ts`   | Implemented |
| Settings onboarding surface | `apps/cli/src/app-shell/settings/SettingsShell.tsx`    | Implemented |
| Playback updates            | `apps/cli/src/app/playback/PlaybackPhase.ts`           | Implemented |
| Shutdown cleanup            | `apps/cli/src/app/session/SessionController.ts`        | Implemented |
| Diagnostics snapshot        | `apps/cli/src/app-shell/panel-data.ts`                 | Implemented |

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
6. Full privacy adds safe poster artwork, a **Play on Kunai** button, and catalog links when ids are known.

If any requirement is missing, Kunai records a diagnostics event and disables automatic retry until
the user reconnects from Settings or changes the presence configuration. Duplicate activity payloads
are skipped to avoid unnecessary Discord IPC churn.

## IPC Protocol Containment

Discord IPC is untrusted input inside an optional integration. Kunai accepts at most a 1,048,576-byte
JSON body and retains at most 1,048,584 unresolved bytes including the eight-byte frame header. Parsed
JSON must have a non-null, non-array object root before the client reads any Discord fields.

Invalid JSON and invalid payload roots report the fault and drop only that completed frame; the same
connection remains usable. A declared-frame or retained-buffer limit violation clears the accumulator,
rejects pending Discord commands, marks only the owning presence attempt not ready, and ends only that
attempt's local Discord socket. Playback and the rest of the Kunai session continue, and a later
explicit reconnect can create a fresh presence attempt.

Under `--debug`, each protocol fault emits `presence.discord-ipc` / `Discord IPC protocol fault` with
bounded metadata only: reason, opcode, declared byte length, and buffered byte length when available.
Payload bytes, activity data, ids, URLs, and headers are never included in this event. Reporting is
best effort, so a logging or observer failure cannot escape the socket callback or change attempt
ownership.

## Lifecycle

| Event                                        | Presence behavior                                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Playback starts                              | Show episode card; start internal binge session clock                                                                                    |
| Progress updates                             | Refresh timestamps/progress when duration is known                                                                                       |
| Pause                                        | Static paused card; schedule clear after `presencePausedClearDelayMs` (default 3 min)                                                    |
| Resume                                       | Cancel pause clear timer; resume playing card                                                                                            |
| Autoplay next episode                        | Keep presence and binge session clock (no flash clear)                                                                                   |
| Post-play idle (mpv closed, up-next overlay) | `clearPlayback("playback-idle")`                                                                                                         |
| Leave playback phase                         | `clearPlayback("playback-exited")`                                                                                                       |
| Quit / shutdown                              | `SessionController.shutdown()` owns a single awaited `presence.shutdown()`; updates/heartbeat/reconnect are ignored once shutdown begins |

Kunai no longer replaces finished playback with a generic "Browsing Kunai" activity.

Presence follows the session's accepted current status rather than raw player
events. Each update carries the playback generation that produced it, and an
update from a superseded process or cycle is dropped instead of sent — a late
event from a replaced or stopped session cannot repaint presence with the
previous title. Presence therefore agrees with the header, loading shell, and
diagnostics by construction, because all four read the same authoritative
status.

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

Discord activity buttons are URL-only (max two). During full privacy playback Kunai fills both:

1. **Play on Kunai** — the https web-share route for the live playback target
2. a catalog button when ids are known — **View episode on TMDB** for TV with a TMDB id,
   otherwise **View on AniList**, **View on IMDb**, or **View on TMDB** for the series/movie

The play button carries the https web-share URL, not the `kunai://` ref, because Discord rejects
any button URL that is not http(s); the web route hands off to `kunai://` on open. A title with no
catalog ids still gets the play button, and a catalog link that resolves to the play target is
dropped rather than shown as a second button to the same place.

Recent Discord clients also support clickable text/image via `details_url`, `state_url`, and
`assets.large_url` when catalog ids are known. `state_url` is set only when the episode page is a
different destination from the title page — a movie has no episode page, and an AniList-only title
resolves both to the same series page, so linking it would point the title and state rows at one
identical URL. The encoded playable `kunai://` ref stays appended to the presence `state` line and
exposed as `playable_ref` in url-fields.

Play-in-Kunai handoffs use the shared `PlaybackTargetRef` codec (see `.docs/share-links.md`). Both
the `kunai://` text ref and the https play button are derived from the live activity via
`buildShareRefForActivity` in `discord-activity-links.ts`, so they stay episode-accurate.
`presenceDiscordOpenUrl` remains in settings for future use but is not wired into the default
activity payload.

Full privacy cards are laid out like music-player presence (Cider-style): show title on
`details`, `S# E# · episode name` on `state`, playback progress via Discord timestamps, and the
show poster as `assets.large_image` when a safe `https://` poster URL is available on the title,
title artwork, or episode artwork (fallback asset key `kunai`). TMDB relative paths such as
`/abc.jpg` must be expanded to `https://image.tmdb.org/t/p/w500/...` before sending to Discord;
`resolve-catalog-poster-url.ts` is the shared resolver. Title-detail prefetch artwork is merged into
presence when search/history rows only stored relative paths. When full privacy still falls back to
`kunai`, diagnostics record `presence.poster.fallback` with the reason. Provider stream URLs,
subtitle URLs, headers, and local paths stay out of Discord payloads.

Upload portal assets from `apps/cli/assets/discord/` with keys `kunai` and `subtitles` for
**fallback** artwork only. External TMDB/AniList HTTPS URLs are the primary series-poster path and
do not require Developer Portal uploads (Discord proxies public HTTPS images).

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
   progress bar after duration is known, clickable catalog URLs, a **Play on Kunai** button, and a
   catalog button when ids exist.
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

The list above is the current presence residue. Do not reopen the archived
implementation plan to infer current behavior.
