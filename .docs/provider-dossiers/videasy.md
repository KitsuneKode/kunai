---
status: current
lastReviewed: "2026-08-13"
---

# Provider: Videasy

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

## Production status (2026-08-13) — cache and transport hardening

Plan 038's active-path correctness work landed. What changed:

- **Identity.** The provider-local `resolveTmdbId` (and its twin in
  `shared/direct-stream-source.ts`) were replaced by one shared
  `resolveTmdbCatalogId()`. Complete positive decimals only; a bare numeric
  `title.id` is still accepted because that is what `-i <id>` and the live smokes
  actually pass.
- **Cache policy.** `createVidkingResultFromPayload()` no longer ignores the policy
  it is handed. `createVideasyRouteCachePolicy()` is the one builder, called only
  after a route answers, and the selected source now carries `metadata.apiRoute`.
- **Wings transport.** Seed / preferred-host / failure state moved onto the shared
  `TTLCache` with hard ceilings (16 / 256 / 32). The seed and preferred-host maps
  were previously unbounded and only ever pruned an entry that was asked for again.
- **Caller abort no longer poisons host health.** This was a real bug: cancelling a
  playback rejected every in-flight seed attempt, and the catch could not tell that
  apart from a genuine failure, so both Wings hosts entered a five-minute penalty
  box. Pinned by `videasy-wings-seed-race.test.ts`, which fails without the guard.
- **HTTP 500 remains transient**, documented once in `classifyVideasyHttpFailure()`
  and pinned by tests. **`wings-tejo` remains deprecated and unimplemented.**

Deliberately **not** done, and why:

- **The logical-request → selected-route cache index was not built.** The design plan
  called for route-specific CLI cache keys with a logical alias index. The CLI's
  stream-cache key is currently route-agnostic and _consistent_ — read, write, and
  invalidation all derive the same preimage from the manifest `keyParts` — so there
  is no key-mismatch bug to fix, and fragmenting the key by route would add cache
  misses for a benefit no test could demonstrate. Stale entries whose route later
  dies are already handled by cache-revalidation stream-health probes.
- **The `wings-transport.ts` extraction was not performed.** The two confirmed
  defects (boundedness, abort classification) are fixed and tested in place. Lifting
  the transport into its own module with an injected clock remains worthwhile
  cleanup, not a release blocker.
- **Deprecated route/WASM deletion was not attempted.** It is separate non-blocking
  cleanup and is explicitly not a release blocker; the routes are proven inert by
  contract tests instead.

## Production status (2026-07-16)

- **Module:** `packages/providers/src/videasy/direct.ts` + `flavors.ts` + `crypto.ts`
- **Active stream API:** `api.speedracelight.com` (sole seed host; used by player.videasy.to / cineby.at / cineplay.to). The `api.wingsdatabase.com` mirror was removed on 2026-08-26 — the name is NXDOMAIN on Cloudflare and Google resolvers and the surviving apex does not serve `/seed`, so it could only lose the race and then occupy the penalty box. The transport still races N hosts via `WINGS_API_BASES`; add a mirror there when a live one exists.
- **Decrypt:** seed + `enc=2` + mvm1 PRNG XOR. **Must use sparse `Array(61)`** for PRNG state (`n in state` mask). Dense arrays break every payload.
- **Cineby UI catalog** (https://www.cineby.at/tv/299167 “Dutton Ranch” example):
  | UI             | API route                  | Live note (S1E1)         |
  | -------------- | -------------------------- | ------------------------ |
  | Yoru           | `/cdn`                     | often empty on TV        |
  | Neon           | `/neon2`                   | **works** (HLS+DASH)     |
  | Sage           | `/ym`                      | title-dependent          |
  | Jett           | `/jett`                    | title-dependent          |
  | Breach         | `/m4uhd`                   | often 403                |
  | Vyse           | `/hdmovie` quality=English | title-dependent          |
  | Killjoy        | `/meine` language=german   | **works** with imdbId    |
  | Fade           | `/hdmovie` quality=Hindi   | title-dependent          |
  | Omen           | `/lamovie`                 | **works**                |
  | Raze           | `/superflix`               | needs full params        |
  | Cypher (Kunai) | `/downloader2`             | **works** quality ladder |
- **Inventory order:** matches Cineby Servers UI — Yoru → Neon → Sage → Jett → Breach → Vyse → Killjoy → Fade → Omen → Raze; **Cypher** is Kunai-only after the catalog (not shown on the website).
- **Resolve order:** Phase A is Yoru → Cypher → Neon → Sage → Jett → Breach → Vyse; localized Killjoy/Fade/Omen/Raze stay Phase B / lazy.
- **Legacy:** `api.videasy.to/{server}/sources-with-title` still **404**.
- **Fixtures:** Study Group `233347` S1E2; Dutton Ranch `299167` S1E1; crypto golden under `packages/providers/test/fixtures/videasy/wings-enc2-neon2.json`.
- **Redaction:** do not store signed HLS URLs, cookies, or session tokens in this dossier.

## Production status (2026-07-11) — historical

- **Live matrix:** **fail** at the time — `api.videasy.to` stream routes 404; wings/speedracelight path not yet wired with working decrypt.
- **Disposition then:** demote from series default + quarantine dead `api.videasy.to` endpoints.
- **Superseded by 2026-07-16** repair of crypto + host + Cineby catalog mapping.

## Production status (2026-05-27) — historical

- **Videasy fetch timeout:** **90s** per server attempt; engine `attemptTimeoutMs` aligned (~300s cap for full cycle).
- **Default resolve (Phase A):** up to **3** English mirrors in order — **Luffy** (`mb-flix`) → **Zoro** (`cdn`) → **Nami** (`downloader2`); no 4+4 embed fanout on the default path.
- **Phase B (lazy):** remaining English flavors + preferred audio language (e.g. Brook / German) probed in background via `VideasyLazySourceProbeService`; inventory merges without blocking first play.
- **Source presentation:** providers emit `source.label` (themed name), `metadata.flavorArchetype` (subtitle), stable `source:videasy:videasy:{endpoint}` ids — shell does not map endpoints.
- **Title health:** advisory only; does not reorder resolve (see `.docs/title-provider-health-and-cache-reset.md`).
- **Query parity:** `tmdbId`, season/episode, `year`, `imdbId`, `_t` on Videasy requests.
- **Preferred source fallback:** when a pinned flavor fails, resolve falls back to Phase A mirrors before embed-referer retry.
- **Endpoint quarantine:** deprecated routes (`1movies`/Sanji) are seeded into shared `endpointHealth`; HTTP 404/410 and persistent 5xx are quarantined at runtime (persisted in cache DB). Preferred pins on quarantined endpoints are cleared automatically.

## Summary

- **Media kinds:** Movies, TV Series.
- **Search support:** Yes, proxy to TMDB API.
- **Episode catalog support:** Yes, proxy to TMDB (`/tv/{id}/season/{s}`).
- **Stream resolve support:** Yes, via AES-encrypted payloads decrypted via WASM.
- **Language/audio/subtitle model:** Variable. Often relies on server-derived language aliases (e.g., passing `?language=german`) or multiplexes audio into the `quality` field (`English`, `Hindi`).
- **Server/source model:** Videasy **endpoints** (`mb-flix`, `cdn`, …) exposed in UI as themed **sources** (Luffy, Zoro, …). Same endpoint → same label and `sourceId` on every episode.
- **Quality model:** Standard (1080p, 720p). Muxed in the `.m3u8` manifest or passed directly as stream metadata.
- **Thumbnail/poster support:** Yes. Episode thumbnails via TMDB `still_path`. Seek-bar thumbnails natively available in `#EXT-X-IMAGE-STREAM-INF` within the resolved HLS manifest.
- **Legacy alias:** `vidking` remains accepted as a config/cache/provider-id alias for this provider.
- **Known failure modes (2026-07-11 primary):** stream API route-dead (`sources-with-title` HTTP 404). Historical: slow responses (>12s false timeouts — now 90s), empty WASM keys, TMDB rate-limiting, HLS image-stream gaps, shared endpoints needing `languageQuery` / `filterQuality`.

## User-Facing Capabilities

| Capability            | Supported | Evidence                                    | Notes                                                                         |
| --------------------- | --------: | ------------------------------------------- | ----------------------------------------------------------------------------- |
| Search                |       yes | `search/multi` TMDB proxy endpoint          | Data originates from TMDB proxy. High stability. User-visible.                |
| Episode list          |       yes | `/tv/{id}/season/{s}` TMDB proxy            | High stability. Affects cache identity (season-level).                        |
| Server switch         |       yes | Returns multiple provider nodes             | Nodes often correlate to audio language. User-visible in player settings.     |
| Quality switch        |       yes | Manifest parsing (`EXT-X-STREAM-INF`)       | Resolution parsed from HLS. Stable. Used for playback/downloads.              |
| Audio language switch |       yes | `?language=` endpoint or `quality` string   | Varies by sub-architecture (Meine vs HDMovie). Affects stream cache identity. |
| Soft subtitles        |       yes | Native HLS `EXT-X-MEDIA:TYPE=SUBTITLES`     | Stable. Affects user-visible caption menus.                                   |
| Hardsubs              |     maybe | Embedded in video stream                    | Usually defaults to soft-subs, but specific older sources may bake them in.   |
| Downloads             |       yes | `yt-dlp` with optional `ffprobe` validation | Reliable. Requires downloading HLS chunks and sidecar VTTs separately.        |

## Provider Data Shapes

- **Search result fields:** Standard TMDB response (`id`, `title`, `poster_path`, `media_type`). Sourced directly from TMDB; highly stable. User-visible.
- **Episode fields:** TMDB season payload (`episode_number`, `name`, `still_path`, `overview`). Stable. Cache impact: cache by Series ID + Season.
- **Stream candidate fields:** `sources` array containing `url`, `quality` (often abused for language like "Hindi"), `type` ("hls"). Originates from WASM decrypt. Crucial for playback and cache identity.
- **Subtitle fields:** `tracks` array containing `file` (URL), `label` (Language), `kind` ("captions"). Originates from API response or `.m3u8`. User-visible in player.
- **Thumbnail/artwork fields:** `poster_path` and `backdrop_path` for main UI. `still_path` for episode rows. `#EXT-X-IMAGE-STREAM-INF` for seek-bar sprites.

## Flow

```mermaid
sequenceDiagram
  participant UI
  participant SearchIntent
  participant Provider
  participant ResolveService
  participant SourceInventory
  participant MPV

  UI->>SearchIntent: structured filters
  SearchIntent->>Provider: supported upstream filters
  Provider-->>UI: results + evidence
  UI->>ResolveService: selected title/episode/preferences
  ResolveService->>Provider: resolve stream
  Provider-->>SourceInventory: streams/subtitles/sources/quality
  SourceInventory-->>MPV: selected playable stream
```

## Edge Cases

- **Empty result:** TMDB proxy returns 200 OK with `results: []`. Shell should display generic empty state.
- **Region/block:** Cloudflare 403 on the resolving endpoint. Handled by fallback to alternate provider.
- **Expired stream:** The `.m3u8` token expires (usually ~2-6 hours). Re-resolve needed. Affects Cache TTL.
- **Slow response:** WASM execution can be slow on low-end devices. Should not block UI mounting (Deferred Locators).
- **Missing subtitle:** Empty `tracks` array or missing `SUBTITLES` in HLS. UI must hide subtitle button.
- **Hardsub-only:** Detected when video stream is provided but `tracks` is empty. No UI flag needed, just absence of options.
- **Multi-server duplicate:** Multiple servers return the exact same source URL. Shell deduplicates by hashing the `url`.
- **Language encoded in server name:** "Meine" endpoints rely on ISO codes. HDMovie uses strings like `quality: "Hindi"`. Shell must map string matching to `audioLanguage`.
- **Provider returns HTML in text:** WAF blocks return 200 OK with Cloudflare HTML challenge. Detected by JSON parse failure -> trigger retry/fallback.
- **Provider returns non-playable upcoming episode:** TMDB returns episode data, but VidKing WASM API returns 404/Empty. UI marks as "Not yet aired".

## Recommended Contract Changes

- **Implemented:** Themed `label` + `metadata.flavorArchetype` on `ProviderSourceCandidate`; `flavorLabel` / `serverName` on `StreamCandidate`; registry in `flavors.ts`.
- **Still open:** Explicit `seekBarVTT` from HLS `#EXT-X-IMAGE-STREAM-INF` in direct resolver (dossier previously claimed this; not wired in `direct.ts` yet).
- **Cache key dimensions:** `[Provider]_[MediaID]_[Season]_[Episode]_[ISO_Language]`. Language MUST be in the key.
- **Diagnostics events:** `WASMLoadStart`, `WASMDecryptSuccess`, `WASMDecryptFailed` (trace events exist; expand if needed).
- **Tests:** `packages/providers/test/vidking-flavors.test.ts`, `vidking-bloodhounds` live smoke.
- **Lab:** `.reference/experiments/scratchpads/provider-cineby/` for endpoint discovery; transient `CINEBY_*.md` notes are gitignored after 2026-05-27 reconciliation.

## Runtime contract

> Moved from `.docs/providers.md` 2026-08-26.

### Videasy identity, route caching and Wings transport

- **TMDB identity is complete or it is nothing.** `resolveTmdbCatalogId()` in
  `packages/providers/src/shared/catalog-id.ts` is the single reader for every
  TMDB-keyed provider (Videasy and the shared direct-stream source path). It accepts
  an explicit `title.tmdbId`, an exact `tmdb:` prefix, or a bare `title.id`, each of
  which must match `^[1-9]\d*$` and be a safe integer. The bare form is load-bearing:
  `kunai -i 438631 -t movie` and the live provider smokes pass a bare numeric id with
  no `externalIds`. The old `Number.parseInt` readers accepted `123abc`, `123`,
  `0`, `-5`, `4.5` and `1e5`.
- **One owner builds the selected-route cache policy.**
  `createVideasyRouteCachePolicy({ resolveInput, appId, apiRoute })` is the only
  builder, and it may only be called once a route has actually answered — `apiRoute`
  is evidence, not a guess. `createVidkingResultFromPayload()` now **requires** a
  policy and an `apiRoute` and uses the policy verbatim; it previously named the
  parameter `_cachePolicy`, discarded it, and rebuilt an equivalent policy internally
  by re-deriving the route and app id. The selected source records `metadata.apiRoute`
  so route provenance is read explicitly rather than by positionally parsing
  `cachePolicy.keyParts`.
- **Every stream-resolve manifest keys on the whole preference set.** The resolve
  cache key is built from `keyParts`, so a manifest that omits `audio`, `subtitle`,
  `quality`, `startup`, `source`, or `stream` reuses one cached entry across
  different requests for that preference — switching audio or quality then serves a
  stream that answers the previous choice until the TTL expires. Under-keying is a
  correctness bug; over-keying costs at most a redundant re-resolve.
  `bootstrap-providers.test.ts` derives the conformance matrix from
  `loadProductionProviderModules()` and asserts the full set on every production
  stream-resolve provider, including YouTube, so adding a provider cannot silently
  leave it outside the gate.
- **The CLI stream-cache key is route-agnostic, and that is deliberate.**
  `buildApiStreamResolveCacheKey()` in
  `apps/cli/src/services/cache/stream-resolve-cache.ts` derives its preimage from the
  manifest `keyParts`, which carry no `apiRoute`. Read, write, and invalidation all
  use that one key, so they cannot disagree. A stale entry whose route later dies is
  caught by the cache-revalidation stream-health probe, not by key fragmentation.
  The selected-route policy returned by Videasy is result provenance and TTL metadata,
  not a second lookup key. This matters for Vyse and Fade: both resolve through
  `wings-hdmovie`, but their distinct source ids are part of the manifest-driven CLI
  key (as is the request's audio preference), so the shared backend cannot alias their
  cached stream resolves.
- **Wings transport state is bounded.** Seed and preferred-host entries are keyed per
  media id and previously grew for the life of the process — expiry alone never freed
  an entry nobody asked for again. All three maps are now `TTLCache` instances with
  hard ceilings (`WINGS_TRANSPORT_LIMITS`: 16 seed, 256 preferred-host, 32 failure).
  `TTLCache` gained an optional `maxEntries` and an injectable clock; it evicts
  expired entries first and only then the oldest write, and replacing a key never
  counts as growth.
- **Seed-race outcomes are classified by cause.** A host is penalized only for a
  genuine pre-winner failure or timeout. A loser aborted because a peer already won
  is not evidence, and neither is **caller cancellation** — that last case used to
  put both Wings hosts in a five-minute penalty box every time a user walked away
  from a playback. Every transition is covered by deterministic deferred-promise
  tests in `packages/providers/test/videasy-wings-seed-race.test.ts`. When every host
  is penalized the transport still races them rather than giving up, which is why
  host health is asserted directly instead of being inferred from request order.
- **HTTP 500 stays transient.** Only 404 and 410 are `route-dead`. Many
  speedracelight servers answer 500 "No streams available" for one title while
  staying healthy for every other title, so quarantining the endpoint on a 500 would
  take a working route offline.
- **`wings-tejo` stays deprecated and unsupported.** It is not in the active flavor
  list, not eligible, and not scheduled in phase A. Its AES-GCM decoder is not
  implemented and must not be added for a route product code cannot select.
