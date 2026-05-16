# Discord Presence And Media Track Polish

Status: implemented core presence/media-summary slice; future `/tracks` UX remains planned

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

## Remaining Product Work

- Add a first-class `/tracks` surface that groups source, quality, audio, hardsub, and soft
  subtitle choices in one mounted overlay.
- Wire audio/hardsub `LanguageSelectionIntent` paths all the way into player reload behavior where
  provider inventory can satisfy the choice without a fresh provider resolve.
- Add configured preferred quality to normal playback and download resolve input once the selection
  contract is stable.
- Design an opt-in `kunai://` or HTTPS handoff if Discord should offer "Open in Kunai"; Discord
  cannot run local shell commands directly, and any local handoff must require confirmation.
- Generate/upload stable Discord application assets (`kunai`, `subtitles`) through the Discord
  Developer Portal before treating artwork as guaranteed.

## Guardrails

- Never put provider stream URLs, signed manifests, subtitle URLs, headers, local file paths, or
  diagnostics payloads in presence text, assets, or buttons.
- Keep live Discord smoke manual and opt-in with `KUNAI_LIVE_DISCORD_PRESENCE=1`.
- Keep provider/live smoke checks out of CI and default tests.
