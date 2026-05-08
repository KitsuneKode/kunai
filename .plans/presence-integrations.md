# Presence Integrations Plan

Status: partially implemented; client-id entry flow and runtime smoke remaining

## Current Behavior

- Presence is off by default.
- `presenceProvider: "discord"` enables Discord when configuration and runtime dependencies are available.
- `presencePrivacy` controls full versus private activity detail.
- `presenceDiscordClientId` or `KUNAI_DISCORD_CLIENT_ID` provides the Discord app id.
- Missing client id, package, IPC, or update failure records diagnostics and disables retries until process restart.
- About/diagnostics copy shows whether the Discord client id comes from config, environment, or is missing.

## Remaining Implementation

### Slice 1: Setup And Settings

- Add a settings flow for entering or clearing `presenceDiscordClientId`.
- Add `/presence` or settings detail copy that explains required Discord setup.
- Keep `discord-rpc` optional; do not force it into core install unless packaging proves that is simpler.

### Slice 2: Diagnostics And Help

- Surface presence status in diagnostics with a compact reason:
  - disabled
  - missing client id
  - missing package
  - Discord IPC unavailable
  - connected
- Add command/help docs that say presence never sends stream URLs or headers.

### Slice 3: Activity Polish

- Decide stable Discord application assets:
  - `kunai`
  - `subtitles`
  - optional anime/series/movie icons
- Keep activity text conservative:
  - private: generic playback
  - full: title + episode + provider id
- Do not add elapsed progress or episode art until privacy and asset behavior are verified.

## Verification

- Unit-test activity payloads for private and full privacy.
- Unit-test unavailable states do not retry repeatedly.
- Manual smoke with Discord running and `KUNAI_DISCORD_CLIENT_ID` set.

## Canonical Doc

See [.docs/presence-integrations.md](../.docs/presence-integrations.md).
