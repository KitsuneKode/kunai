# KitsuneSnipe — Diagnostics Guide

Use this when a provider, subtitle, playback, cache, or shell flow behaves differently than expected.

For cross-subsystem triage, start with the short
[debugging map](debugging-map.md) and then return here for event shapes,
redaction rules, and export behavior.

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

The diagnostics panel starts with a plain-language health summary for Playback, Provider, Cache, Discord, Downloads, and Network. Each row should say whether Kunai is OK, needs attention, or failed, then give one short reason and action. The detailed provider timeline, cache decisions, mpv events, and recent event log stay below the summary for developer debugging.

Export a redacted support bundle with `/export-diagnostics`. The exported JSON includes app/runtime metadata, startup capability checks, and the bounded diagnostics event buffer. Stream URLs, auth headers, cookies, tokens, and local home-directory prefixes are redacted before writing the file.

For long local debugging sessions, use structured JSONL traces:

```sh
KUNAI_TRACE=provider,playback bun run dev -- -S "Dune" --debug-json
```

`--debug-json` also enables `--debug` and writes newline-delimited redacted diagnostic events under the Kunai state `traces/` directory. `KUNAI_TRACE` is optional; when present it is a comma-separated category allowlist such as `provider,playback,cache`. URL redaction keeps host/path shape and non-sensitive query keys, but redacts tokens, signatures, cookies, authorization headers, and private home-directory prefixes.

Diagnostic events can carry stable correlation fields:

- `sessionId`: one Kunai process/session.
- `playbackCycleId`: one title/episode playback cycle.
- `providerAttemptId`: one provider resolve timeline for that cycle.
- `traceId`: the provider timeline or lower-level trace identifier when present.

For playback recovery debugging, prefer stable operation names over free-form log text:

- `playback.recover.requested`: recover/refetch same playback intent after failure evidence.
- `playback.refresh.requested`: advanced fresh-source request.
- `playback.refresh.cooldown`: repeated voluntary refresh was rate-limited.
- `provider.resolve.timeline`: provider attempts, retries, and fallback outcome for one resolve.
- `resolve.cache.hit`, `resolve.cache.miss`, `resolve.cache.stale`: cache decision.
- `resolve.refetch.failed.cached-fallback`: no fresher source was found, so Kunai kept the current cached stream.
- `source-inventory.cache.hit`, `source-inventory.cache.miss`, `source-inventory.cache.set`, `source-inventory.cache.invalidated`: source inventory cache decisions. These events use short key hashes, not full key preimages.
- `mpv.preflight-definitive-failure` / `preflight-definitive-failure`: one-shot mpv launch was stopped early because the stream preflight proved the URL was dead before IPC took ownership.
- `post-playback.recommendations.seed`: the post-playback screen rendered from already-prefetched recommendations or an empty rail without waiting for a fresh network request.
- `post-playback.recommendations.warm`: non-critical recommendation data warmed in the background after the shell was already usable.
- `post-playback.autonext.prefetch-wait`: auto-next waited briefly for near-EOF prefetch before falling back to normal resolve.
- `download.artifact.validated`: a completed local download passed artifact validation and persisted local size/duration metadata when available.
- `download.artifact.repairable`: the main video is usable, but a subtitle/artwork sidecar needs attention.
- `presence.clear.failed`: Discord presence did not clear cleanly during shutdown or disconnect.
- `storage.maintenance.startup`: startup storage maintenance pruned disposable cache data and optimized databases.

Support bundles include a `correlation` summary listing the IDs seen in the
exported events. Use those IDs to join provider fallback, cache checks, mpv
runtime events, presence background failures, and debug JSONL rows without
guessing from timestamps.

Support bundle sections include the latest operation for each active category,
including `presence` and `download`, so a report can show whether Discord clear
failed, a download artifact was validated, or a queue failure happened without
reading the full event log first. Bundles also include `insights` for provider
resolve, source-inventory cache, post-playback timing, and repairable downloads
so the common questions are visible without reading every event.

Use `/report-issue` for a preview-first issue flow. It asks before writing a redacted diagnostics report bundle and then opens the GitHub issue chooser. Use `/export-diagnostics` when you only want the bundle and do not want to open a browser.

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
- `preflight-definitive-failure`: the legacy/one-shot mpv launcher killed mpv early after a definitive dead-URL preflight. This should be treated as stream failure/fallback evidence, not as a user quit.

## Source Inventory Reasoning

Treat source inventory as layered evidence:

- source/server labels explain where a stream came from;
- variant labels explain quality, presentation, and provider-specific flavor;
- public language fields must be ISO-639 language codes only;
- provider-native labels belong in evidence/metadata and are safe for details or support bundles.

If a diagnostic row shows `language: killjoy`, `language: FlowCast`, or
`language: H-SUB`, the provider adapter leaked source/presentation evidence into
the normalized language field. The correct representation is a blank/unknown
language plus `nativeLabel` or source evidence.

Use [.docs/source-inventory-ui-handoff.md](source-inventory-ui-handoff.md) when
checking whether a picker, history row, download repair row, or post-playback
surface should render a source, language, subtitle, or quality fact.

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
- Provider fallback should emit a provider timeline summary. Retry/fallback progress is informational while work continues; final failure copy should appear only after all configured attempts are exhausted.
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
