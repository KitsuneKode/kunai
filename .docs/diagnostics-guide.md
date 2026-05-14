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

Export a redacted support bundle with `/export-diagnostics`. The exported JSON includes app/runtime metadata, startup capability checks, and the bounded diagnostics event buffer. Stream URLs, auth headers, cookies, tokens, and local home-directory prefixes are redacted before writing the file.

To test Vidking without the Ink shell, run the live provider smoke test:

```sh
KITSUNE_CLEAR_CACHE=1 KITSUNE_DEBUG=1 bun run test:live:vidking 1 2 2> debug.log
```

This currently targets Bloodhounds (`tmdb:127529`) and prints a JSON summary with stream, subtitle, cache, and evidence fields. Use it when the shell UI is getting in the way of provider debugging.

## What To Look For

- `scraper start`: provider URL, subtitle preference, and headless mode were handed to Playwright.
- `m3u8 intercepted`: the playable stream was found.
- `direct subtitle found`: the embed requested a direct `.vtt`, `.srt`, or subtitle CDN URL.
- `wyzie search URL captured`: the embed asked Wyzie for subtitle tracks and we captured the request URL.
- `fetch wyzie subtitles`: KitsuneSnipe is replaying the observed Wyzie request, with only safe request-header keys logged.
- `wyzie response`: HTTP status, success state, and content type from the subtitle lookup.
- `resolved` with `subtitleCount`: stream resolution finished, including how many subtitle tracks were observed.
- `Subtitle resolution`: app-level subtitle selection ran after the provider returned stream data.
- `Skipped history save`: mpv did not report enough position/duration data to persist history.
- `mpv-in-process-reconnect` (diagnostics): persistent mpv performed or attempted a same-URL `loadfile` reload after a stall or premature EOF; see [.docs/mpv-in-process-reconnect.md](mpv-in-process-reconnect.md).

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
- Record user-facing runtime facts through `DiagnosticsService` when you need both structured logs and the diagnostics buffer. Use `DiagnosticsStore` directly only for low-level code that has not been migrated yet.
- Include `category`, `operation`, failure stage, provider id, title id, and timing/provenance context when available.
- Preserve the distinction between “source had no data” and “our scraper did not observe data”.
- Do not print noisy `console.log` output inside Ink render paths; use debug logs or diagnostics events instead.

## Scratchpads

Provider reverse-engineering scripts live in `scratchpads/`. They are allowed to be noisy, interactive, or site-specific because they are research tools, not production runtime.

Current Vidking scratchpad behavior does not exactly match the app runtime:

- Scratchpads usually open `https://www.vidking.net/embed/tv/:id/:season/:episode` visibly and capture whatever the browser emits.
- The app adds `autoPlay=true&episodeSelector=false&nextEpisode=false`, runs headless by default, and resolves the first stream request quickly.
- Scratchpads may treat any `sub.wyzie.io` URL as a subtitle hit, while the app distinguishes search API URLs from direct subtitle files.
- The app replays the observed Wyzie search URL in Node so it can select the preferred subtitle language before launching mpv.

If a subtitle appears in a scratchpad but not in the app, compare the observed Wyzie URL, request header keys, HTTP status, and returned track count before changing provider logic.
