# Diagnostics Reporting UX

Status: planned

## Goal

Make diagnostics useful for normal users, power users, and maintainers without exposing sensitive data or overwhelming the normal UI.

## Normal UI

- Show short, actionable status text.
- Avoid raw stack traces, URLs, headers, and provider payloads.
- Use language like:
  - `Network unavailable · Open offline library or retry`
  - `Provider timed out · Try fallback or wait`
  - `Stream expired · Refresh source`
  - `mpv missing · Open setup`

## Diagnostics Overlay

Render readable sections:

- Current status
- Network
- Provider attempts
- Cache and prefetch
- Player/mpv
- Subtitles
- Offline/downloads
- Recent events

Each section should have a neutral, warning, or issue tone.

## Export Bundle

`/export-diagnostics` writes one redacted bundle with:

- Human summary
- Structured sections
- Bounded raw redacted events
- Provider IDs, names, domains
- Media kind, title id/type, season/episode
- Status codes, failure codes/classes, timings, cache provenance, fallback timeline

Redact raw stream URLs, signed query params, cookies, authorization headers, tokens, API keys, local home paths, and signed subtitle/download URLs.

## Report Issue Flow

`/report-issue` should:

1. Show a preview of included sections.
2. Ask confirmation.
3. Export the redacted bundle.
4. Open a GitHub issue URL with a safe prefilled summary.
5. Fall back to showing issue URL and bundle path if browser opening fails.

## Tests

- Bundle redacts secrets and local paths.
- Provider id/domain survive redaction.
- Report issue preview does not write files before confirmation.
- GitHub issue open fallback shows path and URL.
- Diagnostics overlay groups provider/cache/player/network sections.
