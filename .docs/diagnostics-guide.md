# KitsuneSnipe — Diagnostics Guide

Use this when a provider, subtitle, playback, cache, or shell flow behaves differently than expected.

## Fast Debug Loop

Run with debug logs enabled:

```sh
KITSUNE_DEBUG=1 bun run src/main.ts --debug 2> debug.log
```

Inspect the relevant stage:

```sh
rg "scraper|provider|subtitle|wyzie|m3u8|playback|cache" debug.log
```

Open the in-app diagnostics panel with `/diagnostics` to see the current session snapshot and recent runtime events without leaving the shell.

## What To Look For

- `scraper start`: provider URL, subtitle preference, and headless mode were handed to Playwright.
- `m3u8 intercepted`: the playable stream was found.
- `direct subtitle found`: the embed requested a direct `.vtt`, `.srt`, or subtitle CDN URL.
- `wyzie search URL captured`: the embed asked Wyzie for subtitle tracks and we captured the request URL.
- `resolved` with `subtitleCount`: stream resolution finished, including how many subtitle tracks were observed.
- `Subtitle resolution`: app-level subtitle selection ran after the provider returned stream data.
- `Skipped history save`: mpv did not report enough position/duration data to persist history.

## Subtitle Reasoning

Treat subtitle state as evidence, not a boolean:

- `disabled`: user preference is `none`; no provider work is needed.
- `attached`: a subtitle URL was selected and passed to mpv.
- `tracks available`: provider exposed tracks, but selection still needs to choose one.
- `not found`: provider/embed did not expose subtitle evidence for this item.
- `api failed`: subtitle inventory lookup failed or returned invalid data.
- `search not observed`: the scraper saw the stream request before any subtitle request appeared.

Current provider behavior:

- API providers can return subtitles directly with the stream.
- Playwright/embed providers depend on observed network requests from the embed player.
- Vidking subtitles usually come from either a direct subtitle file request or a `sub.wyzie.io/search` request.

## When Adding Or Fixing Providers

- Log provider-owned milestones with `dbg("provider-id", "...", context)`.
- Record user-facing runtime facts in `DiagnosticsStore` so `/diagnostics` shows them.
- Preserve the distinction between “source had no data” and “our scraper did not observe data”.
- Do not print noisy `console.log` output inside Ink render paths; use debug logs or diagnostics events instead.
