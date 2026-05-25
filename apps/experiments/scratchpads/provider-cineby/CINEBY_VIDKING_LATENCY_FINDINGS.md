# Cineby / VidKing latency findings

Date: 2026-05-25
Scope: The Boys (`tmdb:76479`) S01E01/S01E02, VidKing embed, Cineby page, direct provider modules.
Method: live provider HTTP and Playwright browser capture from `apps/experiments`; no production code changes.

## Commands

```sh
cd apps/experiments
bun scratchpads/provider-cineby/cineby-vidking-latency-harvest.ts
```

Additional bad-path probe:

```sh
cd apps/experiments
bun - <<'EOF'
// See session notes: missing VidKing fixture with retryPolicy.maxAttempts=3.
EOF
```

## Key result

The good path is already fast. The bad path is the problem.

| Path | Result |
| ---- | ------ |
| VidKing direct, The Boys S01E01 | 765 ms, 1 HTTP call, 3 HLS streams, 26 subtitles |
| Cineby wrapper, The Boys S01E01 | 467 ms, 1 HTTP call, same selected HLS host |
| Rivestream, The Boys S01E01 | 419 ms, 2 HTTP calls, 4 streams, 12 subtitles |
| VidKing direct, The Boys S01E02 | 522 ms, 1 HTTP call |
| Cineby wrapper, The Boys S01E02 | 299 ms, 1 HTTP call |
| Rivestream, The Boys S01E02 | 209 ms, 2 HTTP calls |
| VidKing missing movie fixture | 37.7 s, 48 Videasy HTTP 500 responses |

For a valid title where the first VidKing server succeeds, resolving an mpv-compatible URL is sub-second on this machine. The 20-30s user-facing delay is therefore most likely from exhausted or unlucky paths: server loop, query variants, retry attempts, embed-referer tier, provider fallback, or cache miss after a dead/stale stream.

## Why the browser feels faster

VidKing's browser embed does a lot of page work, but the player path can overlap it:

- `db.videasy.net` metadata and season/episode calls happen around page boot.
- `api.videasy.net/*/sources-with-title` produced the stream payload at about 4.1 s in the measured embed run.
- The first HLS playlist loaded at about 4.6 s.
- Wyzie subtitle search loaded after the stream at about 5.1 s.

The CLI direct path skips most page boot work and directly calls `api.videasy.net/{server}/sources-with-title`, which is why the successful direct path is faster than the browser embed. The CLI becomes slower only when it does too much sequential failure work.

## Confirmed bad-path fan-out

Current VidKing direct logic can multiply work like this:

```text
4 direct servers
+ 4 embed-referer servers
× 2 query variants when year is present
× retryPolicy.maxAttempts
```

In the CLI, `createProviderEngine()` defaults to `maxAttempts = 3`, and VidKing also reads `context.retryPolicy.maxAttempts` inside `tryVidkingServer`. The live missing-title probe with one provider-module invocation did:

```text
8 server tiers × 2 query variants × 3 attempts = 48 HTTP calls
```

Every response was HTTP 500 from Videasy and was treated as retryable. That took 37.7 s before the provider gave up.

If this goes through the full engine and the exhausted result remains retryable, the outer provider engine can add another retry layer. That should be treated as a high-risk latency multiplier.

## What Cineby adds

The current production-shaped Cineby module is a research wrapper over VidKing/Videasy endpoints, not a separate backend stack. It can select a single Videasy-compatible flavor/server:

- `mb-flix`
- `cdn`
- `downloader2`
- `1movies`
- `hdmovie`
- `meine`
- `lamovie`
- `superflix`

This is useful for a source/flavor picker and for language-specific sources, but it should not be promoted as a broad fallback until each flavor has live evidence. The fastest shape is not "try every Cineby server"; it is "select one known-good flavor, resolve once, and fallback deliberately."

## What AllManga is doing better

AllManga feels faster because the reverse engineering landed on a cleaner hot path:

- stable GraphQL/catalog API
- known referer fallback
- persisted-query episode source path
- TTL caches for show catalog and episode sources
- bounded provider-local cycle
- no browser or page boot in the hot path

The equivalent target for VidKing/Cineby is one direct source request on the hot path, not browser emulation and not broad server probing.

## Recommended implementation slices

1. Trim VidKing bad-path retries.
   - Treat Videasy HTTP 500/404 "unable to load media sources" as deterministic not-found for that query/server, not retryable transport failure.
   - Do not retry the same server/query 3 times for deterministic provider responses.

2. Stop duplicate query variants when TMDB ID is present.
   - The browser embed and docs are TMDB-id-first.
   - Keep the year variant only behind evidence that a specific server needs it.

3. Separate outer provider retries from inner source retries.
   - A provider module that exhausts all local candidates should usually return a non-retryable exhausted result to the outer engine.
   - Retry transient network exceptions, not complete provider-local exhaustion.

4. Cache or prewarm next-episode inventory.
   - Since a valid VidKing/Cineby episode resolves in ~300-800 ms, near-EOF prefetch should make next episode handoff feel instant.
   - The work key already allows foreground playback and prefetch to join; the main requirement is starting it early enough and not invalidating it unnecessarily.

5. Add a Cineby flavor picker later, not broad auto-fanout.
   - Promote flavors as source choices after per-flavor live evidence.
   - Never resolve every flavor in the blocking path.

6. Cache Rivestream services list.
   - The first call is just a dynamic service list and cost 100-300 ms in live runs.
   - A TTL cache removes that from cold fallback without changing semantics.

## Product direction

The best product path is:

```text
hot path: one chosen provider/source -> one direct source API call -> mpv
near-need: prefetch next episode source inventory before handoff
failure path: classify quickly -> skip deterministic dead candidates -> fallback
manual path: expose source/server picker and diagnostics
research path: browser harvest only for drift/new source discovery
```

Do not make Playwright a routine resolver for Cineby/VidKing. The browser is slower than the direct path when the direct path is correct. Use browser capture to learn what the web app does, then encode the stable direct endpoint shape into provider modules.
