# Discord Presence And Media Track Polish

Status: implemented core presence/media-summary, `/tracks`, quality preference, and opt-in handoff slices

## Implemented In This Sweep

- Discord full privacy activity includes exact progress text, so users can see `position / duration`
  even when Discord renders the timestamp as time remaining.
- Discord full privacy activity includes provider-safe media facts from the selected stream
  inventory: quality, sub/dub presentation, audio language, subtitle language, and subtitle count.
- Discord activity includes only a safe public project button. It does not expose stream URLs,
  subtitle URLs, provider URLs, headers, local files, or shell commands.
- Media-track presence summaries are centralized in the domain model instead of duplicated inside
  the presence service.
- Tests cover the privacy payload, URL redaction, selected media facts, and signed subtitle URL
  churn fallback.
- `/tracks` now resolves to the stream picker and groups stream variants with soft subtitle choices.
- Active soft subtitle selection can attach or disable subtitles without restarting playback.
- Preferred quality is part of media profiles, settings, provider resolve requests, and stream cache
  identity so a changed preference does not reuse the wrong cached variant.
- Discord can show an opt-in `Open in Kunai` button only for configured `https://` or `kunai://`
  handoff URLs; unsafe schemes are ignored.
- Stable source assets for Discord keys `kunai` and `subtitles` live in `apps/cli/assets/discord/`.

## Remaining Product Work

- Wire audio/hardsub `LanguageSelectionIntent` paths all the way into player reload behavior where
  provider inventory can satisfy the choice without a fresh provider resolve.
- Build and register the installer-owned `kunai://` handler, or an HTTPS relay with local
  confirmation, before enabling a default Discord handoff.
- Upload stable Discord application assets (`kunai`, `subtitles`) through the Discord Developer
  Portal before treating artwork as guaranteed in live clients.

## Guardrails

- Never put provider stream URLs, signed manifests, subtitle URLs, headers, local file paths, or
  diagnostics payloads in presence text, assets, or buttons.
- Keep live Discord smoke manual and opt-in with `KUNAI_LIVE_DISCORD_PRESENCE=1`.
- Keep provider/live smoke checks out of CI and default tests.
