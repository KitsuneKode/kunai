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

The diagnostics panel is organized into five sections:

1. **Verdict** — plain-language session health, likely cause, and one recommended next action.
2. **Health** — Playback, Provider, Network, Cache, Subtitles, Downloads, Discord, Release sync, and Memory rows using `OK`, `Needs attention`, `Failed`, or `Unknown`.
3. **Current Playback Evidence** — title, episode, provider, playback state, cache/source state, subtitle outcome, recover status, and slowest startup stage.
4. **Developer Evidence** — correlation IDs, provider timeline/attempts, playback startup, source inventory warnings, mpv/network samples, and recent events.
5. **Export And Report** — `/export-diagnostics`, `/report-issue`, and `kunai diagnostics recent`.

Each health row uses the grammar `OK`, `Needs attention`, `Failed`, or `Unknown`, then a short reason and one practical next step when degraded. Example: `Provider  Needs attention · VidKing timed out · Try fallback provider`.

Diagnostics are first-party and local. Always-on summary events are written to
an in-memory buffer immediately, then best-effort persisted to the local cache
SQLite DB (`diagnostic_events`) in the background. This cache ring is bounded to
the newest 10,000 events or 14 days by default and is pruned with the rest of
disposable cache maintenance. Diagnostics write/read failures must not block
search, playback, provider resolution, shell input, or shutdown.

Export a redacted support bundle with `/export-diagnostics`. The exported JSON includes app/runtime metadata, startup capability checks, a readable `triage` summary (verdict, likely cause, affected subsystems, recommended actions, correlation summary, and last relevant event per subsystem), and the bounded diagnostics event buffer. Stream URLs, auth headers, cookies, tokens, and local home-directory prefixes are redacted before writing the file.

For agent-friendly local inspection without launching the shell:

```sh
kunai diagnostics recent --format jsonl --limit 200
kunai diagnostics recent --format markdown --limit 50
```

The command reads the same redacted cache-DB events used by `/diagnostics` and
support bundles. JSONL is an export/readout format, not the canonical store.

For long local debugging sessions, use structured JSONL traces:

```sh
KUNAI_TRACE=provider,playback bun run dev -- -S "Dune" --debug-json
```

`--debug-json` also enables `--debug` and writes newline-delimited redacted diagnostic events under the Kunai state `traces/` directory. `KUNAI_TRACE` is optional; when present it is a comma-separated category allowlist such as `provider,playback,cache`. URL redaction keeps host/path shape and non-sensitive query keys, but redacts tokens, signatures, cookies, authorization headers, and private home-directory prefixes.

Diagnostic events can carry stable correlation fields and structured envelope context:

- `sessionId`: one Kunai process/session.
- `playbackCycleId`: one title/episode playback cycle.
- `providerAttemptId`: one provider resolve timeline for that cycle.
- `traceId`: the provider timeline or lower-level trace identifier when present.
- `spanId`: groups step events inside a multi-step flow such as `provider.resolve` or `playback.startup`.
- Envelope context fields: `stage`, `status`, `severity`, `durationMs`, `failureClass`, `recommendedAction`, and redacted `subject` facts.

Use `buildDiagnosticEvent(...)` from `apps/cli/src/services/diagnostics/diagnostic-event-helpers.ts` for new instrumentation so operation names, severity, recommended actions, correlation, and redaction stay consistent.

For playback recovery debugging, prefer stable operation names over free-form log text:

- `playback.recover.requested`: recover/refetch same playback intent after failure evidence.
- `playback.refresh.requested`: advanced fresh-source request.
- `playback.refresh.cooldown`: repeated voluntary refresh was rate-limited.
- `provider.resolve.timeline`: provider attempts, retries, and fallback outcome for one resolve.
- `resolve.work.insight`: a redacted local resolve-work graph was exported for request economy diagnostics.
- `resolve.cache.hit`, `resolve.cache.miss`, `resolve.cache.stale`: cache decision.
- `resolve.refetch.failed.cached-fallback`: no fresher source was found, so Kunai kept the current cached stream.
- `source-inventory.cache.hit`, `source-inventory.cache.miss`, `source-inventory.cache.set`, `source-inventory.cache.invalidated`: source inventory cache decisions. These events use short key hashes, not full key preimages. Schema `v5` partitions inventory by quality preference (same identity as resolve, invalidation, Tracks hints, and Videasy phase-B dedupe); diagnostics still never expose the raw preimage.
- `mpv.preflight-definitive-failure` / `preflight-definitive-failure`: one-shot mpv launch was stopped early because the stream preflight proved the URL was dead before IPC took ownership.
- `post-playback.recommendations.seed`: the post-playback screen rendered from already-prefetched recommendations or an empty rail without waiting for a fresh network request.
- `post-playback.recommendations.warm`: non-critical recommendation data warmed in the background after the shell was already usable.
- `post-playback.autonext.prefetch-wait`: auto-next waited briefly for near-EOF prefetch before falling back to normal resolve.
- `playback.startup.timeline`: cumulative foreground-startup stages through first observed playback progress. This separates episode-context preparation, timing wait, provider resolve, stream preparation/materialization, mpv launch/readiness, and initial subtitle attachment without exposing stream URLs.
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
resolve, resolve-work graphs, source-inventory cache, post-playback timing, and
repairable downloads so the common questions are visible without reading every
event.

Resolve-work insights are local-only. They summarize one physical resolve per
ledger, joined lanes/intents, cache provenance, provider attempt graph,
inventory counts, selected source/stream IDs, stream-health decisions when
available, and final outcome. They must not include playable URLs, subtitle
URLs, headers, cookies, tokens, raw title IDs, or arbitrary provider evidence.

Use `/report-issue` for a preview-first issue flow. It asks before writing a redacted diagnostics report bundle and then opens the GitHub issue chooser. Use `/export-diagnostics` when you only want the bundle and do not want to open a browser.

## Maintainer reproduction container (not shipped)

This harness is **maintainer-only**. It is not a user-facing feature and must not
be linked from end-user docs, installers, or in-app help. Use it when a reporter
has already exported a redacted support bundle and you need the same startup
configuration on a small machine.

The image is Alpine + Bun + mpv (target under ~200 MB). `run-repro.sh` mounts the
linux musl release binary, a throwaway XDG profile, and the bundle. Config is
pre-seeded from the bundle's **redacted settings** (or `environment.enabledProviders`
when no `settings` object is present). History rows, titles, search queries,
tokens, and user data paths are never copied into the container profile.

```sh
# Build musl binary if needed
bun run build:binaries -- --only linux-x64-musl

# Reproduce from a host-exported bundle (interactive throwaway shell)
./apps/cli/test/docker/repro/run-repro.sh ./kunai-support-bundle-….json --build

# Non-interactive smoke (version/help + seeded providers)
./apps/cli/test/docker/repro/run-repro.sh \
  ./apps/cli/test/docker/repro/fixtures/sample-support-bundle.json --smoke --build

# Image size + seed privacy assertions
./apps/cli/test/docker/repro/smoke-assert.sh
```

Inside the container: binary at `/usr/local/bin/kunai`, bundle at
`/work/support-bundle.json`, config under `$XDG_CONFIG_HOME/kunai/config.json`.

## Cache And Provider Health Controls

Two shell commands clear disposable local state without touching watch history
or config. Prefer these before blaming a provider or wiping a profile.

### `/reset-provider-health`

**Symptom:** the runtime health line (or provider picker) shows a provider as
`degraded` or `down`, auto-fallback skips it, or playback keeps avoiding a
provider that used to work.

**What it does:** forgets global and/or per-show provider failure memory so
auto-fallback can try those providers again. It does **not** clear cached
stream URLs, history, or config.

When the runtime health provider line includes persisted `degraded`/`down`
status, it appends the exact command: `/reset-provider-health`. After a
successful reset, that health badge disappears from the line.

### `/clear-cache`

**Symptom:** playback keeps reusing a dead or stale stream URL, source inventory
looks wrong for an episode you know should resolve differently, or you need a
fresh resolve without resetting provider failure memory.

**What it does:** clears stream/resolve cache (episode, title, or entire cache),
optionally also provider failure memory via the same picker. Feedback always
reports what was cleared and what was kept. **History and config are never
touched.**

Use `/clear-cache` for stale URLs; use `/reset-provider-health` when the problem
is skipped/down providers rather than cached streams.

## Latency Triage Order

Use `--debug-json` when reproducing provider/playback issues: active-runtime
diagnostic events flow through the same redacted ingestion path as
`/diagnostics` and `/export-diagnostics`.

Read latency evidence in this order:

1. Startup path and slowest completed stage.
2. Correlated physical provider attempts, retries, and fallbacks.
3. Stream provenance, source inventory, cache, prefetch, and reuse decisions.
4. mpv readiness, stall, and reconnect evidence.
5. Subtitle outcome, which may arrive after playback begins.

The app records subtitle availability and late attachment without blocking the
first playable stream. A late subtitle outcome is useful evidence, not proof
that provider resolve was slow.

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
- `inventory-satisfied`: provider/cache inventory includes a subtitle matching the configured language, so late Wyzie lookup is skipped.
- `needs-lookup`: playback can start now, then a late Wyzie lookup should attempt to attach matching subtitles when the player is ready.
- `not found`: provider/embed did not expose subtitle evidence for this item.
- `api failed`: subtitle inventory lookup failed or returned invalid data.
- `search not observed`: the scraper saw the stream request before any subtitle request appeared.

Current provider behavior:

- API providers can return subtitles directly with the stream.
- Playwright/embed providers depend on observed network requests from the embed player.
- Vidking subtitles usually come from either a direct subtitle file request or a `sub.wyzie.io/search` request.
- If mpv reports that `sub-add` did not answer, treat it as late subtitle attachment evidence, not proof that playback died. Check the late subtitle attach outcome, active player state, and mpv track list before blaming provider resolution.

## When Adding Or Fixing Providers

- Log provider-owned milestones with `dbg("provider-id", "...", context)`.
- Record user-facing runtime facts through `DiagnosticsService`. `DiagnosticsStore` is the bounded backing store for reads/snapshots and diagnostics internals, not the active runtime write boundary.
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
