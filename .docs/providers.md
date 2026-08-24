---
status: current
lastReviewed: "2026-08-18"
---

# Kunai — Provider Guide

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Use this doc when adding a provider, changing provider capabilities, or debugging stream resolution. It should explain the current contracts clearly without over-prescribing implementation style.

For new providers and major provider rewrites, start with the intake workflow in [.docs/provider-intake.md](./provider-intake.md) before writing scraper code. Provider work should produce a dossier first when the shape of the site is not already well understood.

For concrete example patterns and demo provider shapes, use [.docs/provider-examples.md](./provider-examples.md).

For **auto-skip timing** (IntroDB + AniSkip), **MAL / catalog identity** for anime, and **templates for wiring new anime providers** into that pipeline, read [.docs/playback-timing-and-aniskip.md](./playback-timing-and-aniskip.md).

## Direction: Provider SDK (Implemented)

Kunai uses a Provider SDK shape modeled after the Vercel AI SDK:

```text
apps/cli shell
  -> ProviderEngine (retry, timeout, fallback, abort)
  -> CoreProviderModule.resolve(input, context) -> ProviderResolveResult
  -> provider-result-adapter -> StreamInfo
  -> mpv
```

### Package Ownership

- `@kunai/types` — canonical TypeScript contracts: `ProviderModule`, `ProviderResolveResult`, `StreamCandidate`, `SubtitleCandidate`, `ProviderFailure`, `ResolveTrace`
- `@kunai/core` — `ProviderEngine` (orchestration, retry, timeout, fallback), `CoreProviderManifest`, `defineProviderManifest`, `resolveWithFallback`, cache-policy helpers
- `@kunai/providers` — supported direct-provider modules (`videasy`, `vidlink`, `rivestream`, `allmanga`, `miruro`) plus research/candidate modules kept out of the production resolver until they pass the provider quality gate. Modules implement `CoreProviderModule` + shared helpers (`resolve-helpers.ts`, `subtitle-helpers.ts`, `source-inventory.ts`, `direct-stream-source.ts`) + manifests co-located with modules.
- `@kunai/storage` — SQLite cache, history, health, source inventory, trace persistence
- `@kunai/schemas` — Zod validation schemas for all shared types
- `apps/cli` — Ink UX, mpv IPC, `ProviderRegistry` (engine compat wrapper), `provider-result-adapter`/`stream-request-adapter` (type conversion), playback orchestration

### Resolution Flow

```
User selects title + episode
  -> PlaybackResolveService
  -> engine.resolveWithFallback(input, candidateIds, signal)
  -> for each provider: engine.resolve(input, providerId, signal)  [built-in retry + timeout]
  -> module.resolve(input, context)  [provider-specific scraping]
  -> ProviderResolveResult { streams, subtitles, sources, variants, trace, failures, healthDelta }
  -> providerResolveResultToStreamInfo(result, title, subtitlePreference)
  -> StreamInfo { url, headers, subtitles, providerResolveResult }
  -> providerHealth.set(healthDelta)  [persist health for adaptive fallback]
  -> mpv
```

### Fallback Layers

Kunai has two fallback layers, and they should stay separate:

- **Global provider fallback** lives in `@kunai/core` / `PlaybackResolveService`. It chooses the next provider only after the active provider is exhausted, explicitly skipped, or unhealthy for the current request.
- **Provider-local cycling** lives below a single provider. It tries that provider's source/server/variant candidates before global fallback. The shared `ProviderCycleEngine` contract models candidate IDs, source/server/variant IDs, native labels, normalized language facts, failure classes, retry count, cancellation, and fallback requests.

Current provider migration is incremental. The shared cycle contract and core engine exist for providers that are ready to use it; provider modules that still own their local loops must emit equivalent source/variant trace events and preserve provider-native labels so diagnostics and UI can explain the path.

Classified offline or network-unavailable failures should stop provider-local
cycling early and prevent global fallback from blaming unrelated providers. Do
not write negative provider health for offline network evidence, cancellation,
or manual-diagnostic work.

User-control semantics:

- retry/recover: retry the current playback intent with fresh evidence
- next server/source: skip the current provider-local candidate when that provider exposes more candidates
- fallback provider: stop the active provider and let global fallback choose the next compatible provider
- cancel: abort resolution without marking the provider unhealthy

### Fallback ordering

The provider the user selected always leads the candidate list. The order of
the _fallbacks_ behind it is a tie-break, applied in
`services/playback/provider-ordering.ts`:

1. configured priority, which is authoritative and preserved exactly whenever
   health is equal
2. effective health, so a `degraded` provider sorts below a healthy one
3. `medianResolveMs`, which only ever separates providers that health has
   already tied

Predictable ordering is a real UX property, so this must never become a speed
sort — a user whose priority list already covers their providers sees no
change. `unknown` health ranks alongside `healthy` because no data is not
evidence of being broken, and an unmeasured latency sorts after a measured one
for the same reason. Hedging amplifies the effect: whichever candidate is
ordered first gets the head start.

### Provider Geo Relay

Kunai supports an optional user-owned provider RPC relay for regions where
provider metadata APIs are geo-blocked or return captcha placeholders such as
AllAnime `NEED_CAPTCHA`.

Important boundaries:

- The relay is **metadata-only by default**. Provider API/search/source JSON can
  route through `/rpc/:providerId`, but mpv still receives the final CDN URL and
  streams directly from the nearest CDN edge.
- Kunai ships no shared public relay URL. Users deploy `apps/relay-server`
  themselves, usually to a US Vercel region.
- The relay is not a generic proxy. Every upstream URL must match the selected
  provider manifest `relayProfile.upstreamHosts`.
- `providerRelay.baseUrl` empty means direct fetches only and zero relay
  overhead.
- `KUNAI_RELAY_BASE_URL` and `KUNAI_RELAY_TOKEN` can override local config for
  smoke tests without persisting secrets.

Local smoke flow:

```sh
bun run dev:relay
export KUNAI_RELAY_BASE_URL=http://127.0.0.1:8787
bun run test:live:relay-allanime
```

To test the relay already stored in the real Kunai config without copying its
credentials into the shell, run `bun run test:relay`. The wrapper reads the
config without modifying it, launches the same isolated AllAnime smoke profile,
and logs only the relay origin and whether a token is present. Explicit
`KUNAI_RELAY_*` values still override stored values.

Use `apps/relay-server/README.md` for Vercel deployment and security notes.

### Endpoint quarantine (dead mirrors)

Providers share a persisted endpoint-health gate on `ProviderRuntimeContext.endpointHealth`:

- **route-dead** (HTTP 404/410): quarantine ~24h in `provider_endpoint_health` (cache DB).
- **server-error** (persistent 5xx): quarantine ~1h, triggered by failures across ≥2 distinct titles **or** ≥3 consecutive failures on a single title. The single-title trigger exists because normal viewing stays on one title, so the distinct-title rule alone never fired in practice. A success clears the streak.
- **transient** (timeout/network): in-memory cooldown only; never persisted.

`runProviderCycle` skips quarantined candidates (`source:skipped`, reason `quarantined`) and records failures/successes by class. Videasy seeds deprecated routes (`1movies`, Sanji) into the gate; runtime quarantine can still learn new dead endpoints. A pinned title source is cleared when its endpoint is quarantined. Resolve-gate stream probes allow slow CDN timeouts (unverified) but fail on definitive 4xx/5xx; playback preflight re-resolves the same provider once with `intent: "refresh"` before cross-provider fallback.

Provider priority is user-configurable:

- `provider` / `animeProvider` remain the default provider for a new session mode.
- `providerPriority` controls movie/series fallback and picker order.
- `animeProviderPriority` controls anime fallback and picker order.
- Priority lists are applied when the provider engine is built and read again
  during playback resolve, so settings changes affect fallback order without a
  restart.
- Unknown provider ids in priority arrays are ignored at runtime; known providers not listed stay available after configured entries.

## Source Model

Use this conceptual hierarchy:

```text
Provider
  -> Source / Mirror
    -> Variant
```

Do not force every site into a fake full tree. Some providers reveal quality, subtitle, hard-sub, or audio data only after browser interception or final manifest resolution. Represent those as candidate metadata and trace evidence.

Provider results should eventually include:

- selected stream candidate
- all discovered stream candidates when possible
- all usable subtitle candidates when possible
- provider/source/mirror trace events
- structured failures
- cache policy or cache hints
- health deltas for provider/source availability

The app should be able to choose provider, source/mirror, quality/variant, audio, and subtitle when the provider exposes enough information.

Request economy rule: do not add provider calls just to make a richer UI. If a
provider already receives sources, variants, subtitles, artwork, thumbnails,
timing hints, external IDs, or native source labels while resolving the selected
playback intent, preserve those facts in `ProviderResolveResult`,
source-inventory cache, and diagnostics. If a fact requires another expensive
endpoint, expose it as unknown/deferred until a user action or budgeted lane
justifies that request.

Subtitle policy:

- config chooses the default subtitle language
- providers expose every usable subtitle candidate they found
- playback should attach all usable subtitle tracks to mpv when possible so users can switch without restarting
- missing subtitles should be explicit trace/diagnostic information, not a silent absence
- late subtitle lookup is allowed after playback starts when provider/cache inventory does not include the configured subtitle language; merely having some unrelated subtitle track must not block Wyzie fallback

Startup priority policy:

- `balanced` is the default and prefers a ready 1080p-or-better candidate when available without extra foreground work.
- `fast` selects the first validated ready stream from the provider-local cycle, even if returned inventory is displayed quality-sorted.
- `quality-first` may spend a bounded foreground budget on richer candidates such as AllManga `Ak`, but required fallback work is not bounded away when baseline candidates are unusable.
- Startup priority is part of stream-result cache, source-inventory, and resolve-work identity so `fast` and `quality-first` results do not masquerade as each other.

Playback selection and language policy:

- **Selection stack (highest wins):** per-episode override → title-level manual source default (`{ providerId, titleId } → sourceId`) → provider auto-select (including global `favoriteSourceNames`) → startup priority chain inside the provider.
- **Cross-episode carry:** only `sourceId` persists across episodes; never carry `streamId` into autoplay or prefetch.
- **Favorites vs title default:** favorites remain global config bias; a manual source pick on one title writes the title default and wins over favorites for that title until changed.
- **Language seam:** `mediaLanguageProfileFor` (via `playback-profile-context`) supplies audio/subtitle/quality for resolve, prefetch, cache keys, and mpv handoff. Anime audio intent uses `resolveAnimeAudioIntent` (`original`/`ja` → sub catalog, `en`/`dub` → dub catalog).
- **Prefetch/cache:** subtitle preference mismatch may soft-reuse prepared video; sub↔dub audio mode change is a hard miss and must re-resolve. Audio-mode switches invalidate episode caches but keep the title source default.
- **Tracks sub/dub rows:** only when provider trace emits `inventory:audio-modes` with both modes confirmed (AllManga and Miruro emit this when the episode catalog exposes sub and/or dub).

Source inventory and language normalization:

- Use `packages/providers/src/shared/source-inventory.ts` for stable source,
  stream, and variant IDs, quality normalization/ranking, source evidence, and
  stream-to-source/variant projection.
- Use `packages/providers/src/shared/hls-ladder.ts` (`expandHlsMasterPlaylist`) to
  expand lone HLS master playlists into ranked quality candidates for Tracks
  `/quality`. Wired for Miruro masters, AllManga `master.m3u8` links, and Vidlink
  playlists.
- Use strict ISO language fields for public stream/subtitle language data.
  Provider labels such as `Vietsub`, `H-SUB`, `HindiCast`, `FlowCast`, or
  site-specific server names belong in evidence/metadata, not in primary
  language fields.
- VidKing and Rivestream use the shared helpers for series/movie source
  inventory. AllManga keeps technical `Sub · Server · mode` labels; Miruro uses
  hybrid character-primary labels with `Sub/Dub · mode` detail.
- UI handoff rules live in
  [.docs/playback-source-inventory-contract.md](./playback-source-inventory-contract.md).

## Provider Types

### `PlaywrightProvider`

Use this when the real stream only appears after a browser player runs client-side JavaScript.

```ts
interface PlaywrightProvider extends BaseProvider {
  kind: "playwright";
  buildUrl(id: string, type: "movie" | "tv", season: number, episode: number): string;
  needsClick?: boolean;
}
```

### Historical `ApiProvider`

Older plans used this shape for HTTP/GraphQL providers with optional Playwright
help for the final embed step. Do not use it for new active providers; implement
`CoreProviderModule` in `packages/providers`.

```ts
interface ApiProvider extends BaseProvider {
  kind: "api";
  search(query: string): Promise<ApiSearchResult[]>;
  resolveStream(
    id: string,
    type: "movie" | "tv",
    season: number,
    episode: number,
    opts: { embedScraper: EmbedScraper; animeLang?: "sub" | "dub" },
  ): Promise<string | null>;
}
```

`opts.embedScraper` is a legacy pattern kept for archival/reference providers.
Active beta providers resolve through direct modules in `packages/providers`.

### YouTube (`packages/providers/src/youtube`)

Third lane provider for standalone videos, playlists, and channels.

- **Search/browse:** Invidious primary with instance rotation; optional Piped fallback (`config.youtubeMetadata.pipedApiUrl`); tertiary `ytsearch:` via yt-dlp when both fail.
- **Detail/quality:** `yt-dlp -J` on cache miss (SQLite `youtube_metadata_cache`, 15-minute TTL). Resolve fails with `yt-dlp-missing` when yt-dlp is absent. Default quality ceiling is **1080p** (`youtubeLanguageProfile.quality`); change under `/settings` → Language → YouTube quality.
- **Playback:** canonical `https://www.youtube.com/watch?v=ID` with mpv `--ytdl-format` (DASH `bestvideo+bestaudio` capped to the profile) and `--ytdl-raw-options` (SponsorBlock, live-from-start). Kunai disables mpv-ytdlautoformat overrides via `--script-opts=ytdlautoformat-domains=` so a user-level `ytdlautoformat` script cannot force 720p. **No full video file is written for play** — mpv streams via yt-dlp; only JSON metadata is cached in SQLite.
- **Downloads:** explicit queue via `d` / download flows; yt-dlp writes `.mp4` to `downloadPath` (or OS default) with `-f` from the same format selector, `--merge-output-format mp4`, cookies/extractor args, and optional `--sponsorblock-remove`; live streams rejected at enqueue.
- **History:** persisted as `mediaKind: "video"`; resume/continue restores youtube shell mode; playlist rows label `#N`.
- **Share:** `kunai://` links use `cat=youtube:VIDEO_ID` and `kind=video`.
- **Settings:** `/settings` → YouTube section for Invidious instance, Piped URL, cookies, extractor args, SponsorBlock categories (`config.youtubeMetadata.*`). Rebinds provider without restart.
- **Diagnostics:** `/diagnostics` shows yt-dlp version and Invidious health (`youtube.ytdlp.probe`, `youtube.invidious.health` events).
- **Stats:** watch time aggregates under the `video` kind in `/stats`.
- **Dependencies:** `yt-dlp` required for playback and downloads; search can work via Invidious/Piped without it.
- **Age-restricted / members content:** configure `config.youtubeMetadata.cookiesFromBrowser` or `cookiesFile` (no shipped default cookies).

## When A Playwright Provider Can Become Browser-Less

Do not assume every iframe or embed site can be converted into an HTTP-only provider just because AllAnime can.

Move a provider away from Playwright only when research shows at least one of these is true:

- the page exposes a stable JSON or AJAX endpoint for servers or source links
- the embed URL can be derived deterministically without executing site JS
- the final stream request can be reproduced with normal headers and referers
- the remaining browser step is just a last-mile embed scrape, which fits the hybrid `ApiProvider + embedScraper` pattern

Keep Playwright when the real stream only appears after runtime JS, player boot code, anti-bot challenges, or click-driven state that cannot be reproduced cheaply and reliably over plain HTTP.

Providers must not import Playwright directly once runtime ports land. They should request a browser lease from the injected runtime port. The CLI or future daemon decides whether that runtime is available.

Provider-specific secret material belongs behind runtime ports, not in
`ProviderResolveInput`. For example, VidKing reads an optional
`videasySessionToken` and paired `videasyAppId` from the runtime auth port so
the CLI can use a user-provided Videasy browser session from `/settings` or
`KUNAI_VIDEASY_SESSION_TOKEN` without threading the token through cache keys,
mpv, support bundles, or generic provider request state. `videasyAppId` defaults
to `vidking`; use `bc-frontend` only for Bitcine-minted sessions. This is an
attended session handoff only; do not add code that bypasses Turnstile or
silently harvests browser tokens.

## Registration

- Implement provider module in `packages/providers/src/<provider>/direct.ts` implementing `CoreProviderModule`
- Define manifest in `packages/providers/src/<provider>/manifest.ts` using `defineProviderManifest`
- Export from `packages/providers/src/index.ts`
- Register the module in `apps/cli/src/container/bootstrap-providers.ts` —
  `loadProductionProviderModules()` is the single production provider list
- The `ProviderRegistry` (engine compat wrapper) is built automatically from engine modules

No separate CLI adapter file is needed. The `createProviderFromModule()` factory in `apps/cli/src/services/providers/Provider.ts` creates the CLI `Provider` wrapper with `resolveStream` (calls module), `metadata`, `canHandle`, and optional `search`/`listEpisodes`.

## Workflow Reminder

Provider implementation is not the same thing as provider research.

Use:

- [.docs/provider-intake.md](./provider-intake.md) for the dossier-first research flow
- [.docs/provider-agent-workflow.md](./provider-agent-workflow.md) for repo-local agent instructions
- [.docs/provider-examples.md](./provider-examples.md) for concrete implementation patterns
- [.plans/provider-hardening.md](../.plans/provider-hardening.md) for the broader hardening roadmap
- `packages/providers/src/research.ts` for the current dossier-backed migration queue
- `packages/providers/src/_template.ts` for the new-provider boilerplate

When the site behavior is unclear, gather evidence first and keep knowns vs unknowns separate.

Use `.reference/experiments/scratchpads/provider-*` as the research lab. The reports and probes there are evidence for dossiers and implementation handoffs, not production imports.

## Migration Order From Current Dossiers

The current Provider SDK migration follows the updated dossiers, not the older legacy provider classes:

1. `vidlink` and `rivestream`: primary low-friction movie/series lane for fast CLI startup, broad catalog coverage, and subtitle-rich playback.
2. `vidking`: high-value Videasy source lane; first-class when a valid attended Videasy session exists, but never a cold-start blocker.
3. `anidb` (default anime) plus `allanime` / AllManga-compatible client and `miruro`: active anime lane. Prefer AniDB for ani-cli v5 parity; keep AllManga crypto aligned with live mkissa bootstrap and harden Miruro through the provider matrix.
4. `vidrock`, `rgshows`, `vidapi`, `anikai`, `braflix`, `cineby`, `bitcine`, and `cineby-anime` remain research/candidate paths unless matrix evidence proves they are better than the supported routes.

Quality gate for promotion into the production resolver:

- resolves representative movie/series/anime samples in the provider matrix without browser automation
- median resolve is fast enough for foreground playback, with bounded timeout behavior
- broad catalog hit rate on current samples; misses fail with structured evidence
- usable subtitles or a reliable subtitle fallback plan
- source/quality inventory maps cleanly to Kunai's picker model
- no mandatory per-episode challenge, hidden headless loop, captcha solver, or hostile user setup
- docs and regression samples identify likely drift points

## Design Guidance

- If multiple providers need the same parsing, retry, or URL-construction behavior, extract it instead of copying it
- Keep provider files focused on provider-specific behavior; push shared mechanics into reusable helpers
- Preserve compatibility with provider overrides and existing registry contracts
- Providers handle provider-local mirror/source retries internally, but must emit trace events so diagnostics and UI can show what happened
- The global resolver handles provider-level fallback, ranking, cache reads/writes, health scoring, and user policy
- Providers emit cache policy and hints; they do not write SQLite, history, cache, health, or trace stores directly
- Providers receive runtime ports such as `fetch` or `browserLease`; they do not own environment-specific runtime setup

## Adding a Playwright Provider (future/runtime-browser path)

1. Implement `PlaywrightProvider`
2. Return a stable embed URL from `buildUrl()`
3. Set `needsClick: true` only if playback requires user activation
4. Register the module in `apps/cli/src/container/bootstrap-providers.ts` inside `loadProductionProviderModules()`

Minimal shape:

```ts
export const MyProvider: PlaywrightProvider = {
  kind: "playwright",
  id: "myprovider",
  description: "Short provider description",
  buildUrl(id, type, season, episode) {
    return `https://example.com/embed/${type}/${id}?s=${season}&e=${episode}`;
  },
};
```

## Adding a New Provider (Current Pattern)

1. Copy `packages/providers/src/_template.ts` to `packages/providers/src/<provider>/direct.ts`
2. Define the manifest in `packages/providers/src/<provider>/manifest.ts` using `defineProviderManifest`
3. Implement `CoreProviderModule.resolve(input, context)` returning `ProviderResolveResult`
4. Export from `packages/providers/src/index.ts`
5. Register the module in `apps/cli/src/container/bootstrap-providers.ts` via `loadProductionProviderModules()`

Minimal shape (using shared helpers):

```ts
import {
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  type CoreProviderModule,
} from "@kunai/core";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import type {
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
} from "@kunai/types";

export const myProviderModule: CoreProviderModule = {
  providerId: "myprovider",
  manifest: myProviderManifest,
  async resolve(input, context) {
    // Validate input
    if (!input.allowedRuntimes.includes("direct-http")) {
      return createExhaustedResult(input, context, "myprovider", {
        code: "runtime-missing",
        message: "...",
        retryable: false,
      });
    }
    // ... fetch, parse, build StreamCandidate[], SubtitleCandidate[]
    // On success: return { providerId, streams, subtitles, trace, ... }
    // On failure: return createExhaustedResult(input, context, "myprovider", { code: "not-found", ... })
  },
};
```

If the provider has native search or episode listing, export standalone functions alongside the module. They get wired on the CLI `Provider` wrapper via `createProviderFromModule({ search, listEpisodes })`.

## AllManga / Ani-CLI Parity Policy

`packages/providers/src/allmanga/api-client.ts` contains the crypto/decoder and GraphQL helpers shared by the `allmangaProviderModule`. The module itself (`allmanga/direct.ts`) implements `CoreProviderModule`.

## AllManga / Ani-CLI Parity Policy

- `packages/providers/src/allmanga/api-client.ts` should stay aligned with the specific ani-cli/AllManga-inspired behavior it implements unless Kunai deliberately chooses a different contract
- when AllAnime or AllManga breaks, compare against ani-cli before guessing at a fix
- on this machine, the canonical local ani-cli checkout is `~/Projects/osc/ani-cli`
- if ani-cli is also broken upstream, Kunai may carry a temporary local fix, but that divergence should be documented and easy to remove when parity can be restored
- this is a concrete API-client parity policy, not the default contract for every anime source
- when fixing this family of providers, check:
  - search GraphQL query shape
  - episode list query shape
  - episode source GET with persisted query + `aaReq` AES-256-GCM attestation — without this the API returns `AA_CRYPTO_MISSING`; a rotated key/epoch/build returns `AA_CRYPTO_STALE`/`AA_CRYPTO_INVALID`/`AA_CRYPTO_MISSING_BUILD`
  - dynamic key derivation (`getAllMangaCryptoMaterial`): bootstrap `GET /client-crypto/v1/bootstrap?buildId=140&k=k7` with HMAC `x-aa-boot`, then `key = deriveMaskKey(buildId) XOR partB` (see `packages/providers/src/allmanga/crypto.ts`). Bundled material is fallback only
  - `aaReq` AES-256-GCM over `{v,ts,epoch,buildId,qh,k}` with IV `SHA-256(epoch:buildId:qh:ts:k)[0:12]`; send `x-build-id` on API GETs
  - `tobeparsed` AES-256-GCM decoding: base64(0x01 || iv12 || ct || tag16)
  - source-name inventory and ranking (`Default`, `Yt-mp4`, `S-mp4`, `Mp4`/mp4upload, `Luf-Mp4`, `Ak`; Filemoon removed upstream)
  - downstream link extraction from decoded source URLs — `Mp4` scrapes the embed HTML for `src: "…"` and plays with `Referer: https://www.mp4upload.com` plus mpv `--tls-verify=no`

### AllAnime NEED_CAPTCHA (2026-08-13)

The "valid episode catalog, zero extracted streams" symptom is **not** a crypto or
parity defect. Measured against the production constants (`api.mkissa.net` +
`https://mkissa.to` referer + build id 81):

- Bootstrap succeeds, `keyHex` and `queryHash` are both 64 chars, the `aaReq`
  attestation is accepted, and **no** `AA_CRYPTO_*` error is returned.
- The episode **catalog** query resolves normally (11 episodes for the
  Demon Slayer fixture, titles and all).
- The episode **sources** query returns `NEED_CAPTCHA` on every valid host/referer
  pair — `api.mkissa.net` ← `mkissa.to` and `api.allanime.day` ← `allmanga.to` both
  return it; `api.allanime.day` ← `allanime.to` is a flat HTTP 403.

That asymmetry — catalog ungated, sources gated — is exactly what produced a full
episode list next to zero streams.

`NEED_CAPTCHA` was previously unhandled anywhere in the codebase: it fell through
the retry loop, `rawSources` stayed empty, and the user saw
`No streams extracted from AllManga for episode N`. It is now
`AllMangaCaptchaError`, classified as **`blocked` and non-retryable** (a captcha is
not a network fault and retrying or re-bootstrapping cannot clear it), with a
message naming the one thing that does help — a user-owned relay in an ungated
region. It is checked _before_ the crypto-staleness and rate-limit branches so it
cannot be mistaken for either.

A relay running on the same machine as the client does **not** clear the gate,
because the egress IP is unchanged; a relay deployed to an ungated region is the
untested variable. AllAnime was dropped from the automatic anime lane on
2026-08-13 while staying a registered, manually selectable production module.

The 2026-08-24 build-140 repair makes AllAnime usable again where the source
endpoint is not captcha-gated. No priority-default change is needed:
`animeProviderPriority` is ordering rather than an allowlist, so registered
providers omitted from the array remain available after its named entries. The
NEED_CAPTCHA classification and relay hint stay because geo/bot-gated networks
can still hit the gate.

**Do not restore historical crypto.** Build 140, the current mask constants,
HMAC `x-aa-boot`, and AES-256-GCM are the verified contract. The older build 81
or 119 material, epoch/partB query construction, and AES-CTR decryption must not
be restored.

### AllAnime via user relay (2026-08-17)

With a user-owned relay in place, AllAnime works end-to-end. `bun run
test:live:relay-allanime` passes with real streams (e.g. `video.wixstatic.com`
1080p mp4 via the `Default` source).

- The relay egress (Vercel `iad1` in the reference deployment) reaches
  `api.mkissa.net` and `cdn.mkissa.net` without a Cloudflare challenge and is
  **not** captcha-gated for the episode sources query.
- On 2026-08-17 the upstream build rotated **81 → 119** and the epoch scale
  moved from 3-day to **7-day** (`epochMs: 604800000`, 1-day grace, plus a
  `switchAt` boundary). The old material answered `AA_CRYPTO_MISSING_BUILD`.
  The new constants (build id `119`, mask fragments, epoch scale, and the
  episode persisted-query hash `ca735f…`) were re-derived from the live site:
  string table + rotation from the crypto chunk (`CA0Qy_FU.js`, 144-entry
  table, rotation verified by recomputing the browser's `x-aa-boot` HMAC) and
  the episode hash from the `_9` GraphQL template in the same chunk, then
  confirmed against a real browser session's network traffic. The same
  procedure applies on the next rotation.
- The episode sources request now also carries `k: "k7"` in `extensions`
  (alongside `persistedQuery` + `aaReq`), matching the live site.

**Relay gaps found and fixed the same day:**

- **The relay metadata allowlist was dropping provider-auth headers.**
  `x-build-id`, `x-aa-boot`, `x-obfuscated`, and `x-session-token` were not in
  `METADATA_HEADER_ALLOWLIST`, so every bootstrap through a relay failed with
  `invalid_boot_token` even when the client material was correct. They are now
  forwarded (header-text validation still applies); `x-obfuscated` is also
  passed through on relay responses for Miruro pipe decoding.
- **Deployed relays go stale with provider manifests.** The relay server builds
  its host registry from `@kunai/providers` manifests at deploy time. A relay
  deployed before the mkissa migration rejects `api.mkissa.net` with
  `host-not-allowed`. After any change to a provider's `relayProfile.upstreamHosts`,
  redeploy the relay. `apps/relay-server` also pins `typescript@5.9.3` because
  Vercel's `@vercel/node` builder crashes on the repo-wide TypeScript 7.

**wixmp referer: current behaviour retained.** Plan 036 proposed attaching the
mkissa site referer for `repackager.wixmp.com`, gated on a fixture proving the
current final-stream fallback insufficient. No such fixture can be built from this
network: the pipeline never reaches source extraction, so there is no live wixmp
row to characterize. Per that gate, `resolveDirectStreamReferer()` is unchanged.
mp4upload keeps its dedicated referer and scoped `--tls-verify=no`; TLS
verification is not broadened to any other host.

### AllAnime crypto rotation 119 → 140 (2026-08-24)

The bootstrap started answering `{error:"unknown_build_id"}` (HTTP 404) — build
**119 is retired**, current build id is **140**. This rotation also changed the
derivation constants, which upstream now ships as a config object (`Fd`) in the
obfuscated crypto chunk instead of hard-coding them:

- `hashBuildId` mixes `(index * saltMul + saltAdd)` = `*250 + 54` (was `*17+31`)
- `deriveMaskKey` mixes `(fragmentIndex * fragMul + byteIndex * fragAdd)` =
  `*16 + *217` (was `*41 + *7`)
- new mask fragments; episode persisted-query hash unchanged
- boot token layout changed: first HMAC message is now `{bootPrefix}{buildId}`
  (prefix `4X2PsZc2r:`), second HMAC covers
  `group.host.lane.buildId.epoch` joined by `.` (was
  `buildId:keyGroup:host:epoch:lane` joined by `:`)

Recovery procedure (worked end-to-end against live bootstrap + episode sources):

1. Fetch the mkissa home page, follow `_app/immutable/entry/*.js`, then the
   chunks they reference on `cdn.mkissa.net`; find the chunk containing
   `/client-crypto/v1/bootstrap`.
2. Slice out the self-contained crypto region between `const _I=` and the
   second string-table client (`const Tt=ms;`), append exports of the scoped
   symbols, and run it under Bun with dynamic `import()` — the chunk's anti-debug
   console patching silences `console.log`, so write through
   `process.stdout.write`. That yields buildId, mask fragments, and the config
   object directly.
3. Verify: computed `x-aa-boot` must return HTTP 200 partB from bootstrap, then
   decrypt a real `tobeparsed` blob with the derived key before shipping.

On a cold resolve, the episode catalog and crypto bootstrap start concurrently;
the existing per-request timeouts and stale-material retry policy are unchanged.
Trace output records only the combined preparation duration and readiness, never
the bootstrap material, attestation, token, or source URLs.

Note: ani-cli v5 (2026-08-01) left AllAnime/mkissa for **anidb.app** and deleted its AllAnime code
entirely, so **there is no upstream parity reference left** for this provider — the "compare against
ani-cli" step above applies to AniDB only. For mkissa crypto the live JS chunk is the sole source of
truth. Kunai keeps AllManga as a registered secondary anime source with `anidb` as the
default anime provider. See [.docs/research/anidb-provider-dossier.md](./research/anidb-provider-dossier.md).

Parity tip: for AniDB compare against local ani-cli `master`. For mkissa crypto, the live JS chunk is the source of truth when ani-cli no longer tracks it. The API rate-limits bursts (~3s), so stale-material recovery re-bootstraps keys instead of retry-storming.

Recommended workflow:

1. compare behavior with the local ani-cli checkout
2. identify whether the break is shared upstream or Kunai-specific
3. if shared upstream, implement the smallest temporary local fix needed here
4. document the divergence and what should be removed once upstream parity is restored

## Capability Flags

| Field                   | Meaning                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `isAnimeProvider: true` | Include provider in anime mode                               |
| `needsClick: true`      | Scraper performs an activation click after navigation        |
| `searchBackend`         | Documents which search backend currently feeds this provider |

## Active Beta Providers

Active providers are registered in `apps/cli/src/container/bootstrap-providers.ts` via
`loadProductionProviderModules()`. A module existing under `packages/providers/src/` does not make
it live, and release signoff derives its cases from that list plus the configured lane defaults.

`anidb` is the **default** provider-native anime catalog and the first configured
anime priority (`animeProvider: "anidb"`, `animeProviderPriority: ["anidb"]`).
The priority list is ordering, not an allowlist: registered `allanime` and
`miruro` modules remain available after AniDB and are manually selectable. See
"AllAnime NEED_CAPTCHA" below and the Miruro pipe contract for their network
failure modes.

| ID           | Content Types | Runtime     | Module Location                               |
| ------------ | ------------- | ----------- | --------------------------------------------- |
| `vidlink`    | movie, series | direct-http | `packages/providers/src/vidlink/direct.ts`    |
| `rivestream` | movie, series | direct-http | `packages/providers/src/rivestream/direct.ts` |
| `videasy`    | movie, series | direct-http | `packages/providers/src/videasy/direct.ts`    |
| `anidb`      | anime         | direct-http | `packages/providers/src/anidb/direct.ts`      |
| `allanime`   | anime, series | direct-http | `packages/providers/src/allmanga/direct.ts`   |
| `miruro`     | anime         | direct-http | `packages/providers/src/miruro/direct.ts`     |

### Anime catalog identity

Provider manifests expose `catalogIdentity` (`provider-native` | `anilist` | `tmdb`) via `resolveProviderCatalogIdentity()` in `@kunai/core`.

- **AniDB (`anidb`)** — `provider-native`, and the default anime route. Native ids must satisfy
  `slug-positiveNumericSuffix`; numeric AniList ids and opaque AllAnime ids are not AniDB ids. The
  AllManga Tier-1 lookup never runs for AniDB, and only a validated AniDB slug may be written to
  `providerNativeIds.anidb` — otherwise the result keeps its catalog identity.
- **AllAnime (`allanime`)** — `provider-native`, registered as a fallback and
  manually selectable. AniList-backed discovery
  results are remapped to opaque AllAnime show ids before resolve; `externalIds.anilistId` is
  preserved on merge. An AllAnime lookup may populate only `providerNativeIds.allanime`.
- **Miruro** — `anilist`. Discovery ids stay numeric AniList ids; no AllManga Tier-1 remapping runs.
- **AllAnime and Miruro episode numbering** — when a request carries both a
  season-relative `episode` and `absoluteEpisode`, their APIs receive the
  season-relative value. Absolute numbering is used only for an absolute-only
  request. AniDB keeps its separate catalog-proven routing policy below.

A catalog's own id space is numeric, so a non-numeric id is never accepted into the `anilistId` or
`tmdbId` slot even when the active provider declares that catalog identity.

### AniDB catalog search compatibility

Advanced AniDB discovery uses the explicitly declared compatible AniList catalog
(`compatibleProviders` in `apps/cli/src/services/search/definitions/`), retaining AniList identity
until a validated AniDB slug is found. It **never** falls through to the default TMDB catalog: when
no compatible catalog exists, `SearchRoutingService` returns either a diagnosed provider-native
fallback or an `unsupported` result carrying filter evidence, each with
`attemptedDefaultFallback: false`.

### AniDB browse parsing

`packages/providers/src/anidb/browse-parser.ts` is the single parser for both markup generations,
used by search and resolve so they cannot drift apart:

- It captures the complete anchor opening tag first and only then parses and validates `href`;
  href matching never delimits the attributes used for title extraction.
- Attribute matching is anchored on a start-or-whitespace boundary, so `data-href`, `xlink:href`
  and `data-original-title` cannot shadow the real attribute.
- Title precedence is anchor `title` / `aria-label` → image `alt` → nested text, so a `title`
  placed after `href` still wins.
- Legacy relative `/anime/<slug-id>` cards and current absolute `https://anidb.app/anime/<slug-id>`
  cards both parse; entities decode in a single pass; rows without a positive numeric suffix are
  rejected; results dedupe by validated slug.
- Only anchors carrying result-card evidence (a `title`/`aria-label` attribute or nested card
  markup) become results, so nav, breadcrumb, related-rail and footer links cannot become
  `results[0]` and pin the wrong show.
- Live cards also carry a poster `img`, a TV/Movie/ONA/… badge, and a star rating (`5.3`). Search
  maps poster and rating onto `ProviderSearchResult`; a Movie badge becomes `type: "movie"`. The
  card has no year — Kunai does not invent one. Placeholder `img` srcs (`placeholder.svg`) and
  non-http(s) srcs are dropped. Relative posters resolve against `https://anidb.app/`.

### AniDB metadata and language evidence

The active `anidb.app` episode endpoint is a stream catalog, not a rich episode metadata catalog:
it currently returns episode ids, numbers, and filler flags. `anidb.listEpisodes()` first follows
the title page's explicit cross-link to the official AniDB AID and enriches from the official XML
catalog. It then uses the existing shared AniList/Jikan path for still thumbnails and missing fields
when the title identity carries an AniList or MAL id. This keeps the metadata authority explicit
instead of pretending those fields came from `anidb.app`.

- `anidb.app` language evidence is per episode: `jpn` is the sub/original embed and `eng` is the
  dub embed when present. Search does not advertise both modes blindly; availability is confirmed
  only by the episode languages response.
- A missing requested language is an exhausted AniDB attempt. It must not fall back to the other
  language and label the stream incorrectly.
- Only exact `jpn` (sub/original) and `eng` (dub) catalog evidence is accepted.
  The requested mode resolves first; the alternate starts concurrently but is
  skipped for `fast`, bounded to 1 second for `balanced`, and bounded to 4
  seconds for `quality-first`. A timed-out alternate is aborted and is not
  advertised as an available source.
- The embed probe currently exposes an HLS source but no independently addressable subtitle track.
  AniDB results keep `subtitles: []` and mark subtitle delivery unknown; `jpn` is not sufficient
  evidence that captions are hardcoded.
- Official AniDB XML is a separate catalog namespace. It can provide richer anime and episode
  metadata, but its AIDs must not be confused with the numeric ids in `anidb.app` URLs. See
  [the metadata capability dossier](./provider-dossiers/anidb-metadata-capabilities.md).

The cost model matters as much as the data, because this runs in front of the episode picker:

- Official AniDB XML is **one request for the whole series**, cached for a month and seeded into
  the shared episode-metadata cache, so a second listing of the same show is free.
- AniList runs even when every title is already known — it is a single request and the only source
  of episode stills AniDB has.
- Jikan is the expensive pass (100 episodes per page, strict rate limit) and is **skipped** when
  official titles already cover the catalog, matching the AllManga path via
  `shouldSkipExternalEpisodeMetadataEnrichment()`.
- An official response that carries `<error>` (rate limit, ban, bad client credentials) is never
  cached. Caching what it parses to would suppress every episode title for that show for a month
  after the block lifted.
- AniDB is relay-registered (`/rpc/anidb`, settings toggle). Metadata HTML/JSON uses `context.fetch`
  with curl fallback. HLS ladder expansion uses the same path so a relay miss does not collapse
  qualities to a silent `auto` row. Video remains direct from `hls.anidb.app`. `videoFallback` is
  still parsed and persisted, but has no production reader and no `/stream/` handler — do not
  enable it.

### AniDB metadata and language evidence

The active `anidb.app` episode endpoint is a stream catalog, not a rich episode metadata catalog:
it currently returns episode ids, numbers, and filler flags. `anidb.listEpisodes()` first follows
the title page's explicit cross-link to the official AniDB AID and enriches from the official XML
catalog. It then uses the existing shared AniList/Jikan path for still thumbnails and missing fields
when the title identity carries an AniList or MAL id. This keeps the metadata authority explicit
instead of pretending those fields came from `anidb.app`.

- `anidb.app` language evidence is per episode: `jpn` is the sub/original embed and `eng` is the
  dub embed when present. Search does not advertise both modes blindly; availability is confirmed
  only by the episode languages response.
- A missing requested language is an exhausted AniDB attempt. It must not fall back to the other
  language and label the stream incorrectly.
- The embed probe currently exposes an HLS source but no independently addressable subtitle track.
  AniDB results keep `subtitles: []` and mark subtitle delivery unknown; `jpn` is not sufficient
  evidence that captions are hardcoded.
- Official AniDB XML is a separate catalog namespace. It can provide richer anime and episode
  metadata, but its AIDs must not be confused with the numeric ids in `anidb.app` URLs. See
  [the metadata capability dossier](./provider-dossiers/anidb-metadata-capabilities.md).

The cost model matters as much as the data, because this runs in front of the episode picker:

- Official AniDB XML is **one request for the whole series**, cached for a month and seeded into
  the shared episode-metadata cache, so a second listing of the same show is free.
- AniList runs even when every title is already known — it is a single request and the only source
  of episode stills AniDB has.
- Jikan is the expensive pass (100 episodes per page, strict rate limit) and is **skipped** when
  official titles already cover the catalog, matching the AllManga path via
  `shouldSkipExternalEpisodeMetadataEnrichment()`.
- An official response that carries `<error>` (rate limit, ban, bad client credentials) is never
  cached. Caching what it parses to would suppress every episode title for that show for a month
  after the block lifted.

### AniDB season routing and episode numbering

AniDB models each season as its own title, so `routeAnidbSeason()` in
`packages/providers/src/anidb/season-routing.ts` decides identity and numbering from evidence:

- Season 1 retains the base title.
- Season 2+ searches `<normalized base> Season N` and requires both a matching parsed season and
  exact/prefix normalized base-title evidence. An ambiguous best score fails closed with a
  structured `not-found` rather than resolving the wrong title.
- `absoluteEpisode` survives CLI adaptation but is consumed **only** when the routed title's own
  resolved AniDB episode catalog contains that exact episode number. A missing season label is not
  evidence. A season-specific title, an unconfirmed base, and every routed season sibling use the
  one-based cour episode.
- The resolve trace records requested season, base id, routed id, route evidence, numbering
  evidence and reason, episode number, and whether the absolute episode was used.

### Title identity persistence contract

History and continuation use **canonical catalog ids** as the merge key (`anilistId` for anime, `tmdb:…` for series/movie) via `resolveCanonicalCatalogTitleId()` / `resolvePersistedHistoryTitle()` in `@kunai/core`.

- **`externalIds.providerNativeIds`** — per-provider opaque show ids (e.g. AllAnime `bxCKT…`) stored in `history_progress.external_ids_json`. Written on playback upsert and backfilled immediately after anime remap (`persistProviderNativeMapping`).
- **Read path** — `HistoryRepository.getLatestForTitleIdentity()` tries the canonical id first, then falls back to the session opaque id for legacy rows.
- **AllAnime bridge** — `resolveAllMangaShowId` reads `providerNativeIds.allanime`, then the durable SQLite `provider_title_bridge` cache (TTL class `provider-metadata`), then in-process search bridge. Bridge results are persisted to both history metadata and the cache adapter injected through `ProviderRuntimeContext.titleBridge`.
- **Legacy repair** — `HistoryIdentityConsolidator` runs once at CLI bootstrap (catalog-proof rows only; set `KUNAI_HISTORY_IDENTITY_DRY_RUN=1` to log without writing). Continue-watching dedupes display rows by catalog id without DB writes.

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
- **The CLI stream-cache key is route-agnostic, and that is deliberate.**
  `buildApiStreamResolveCacheKey()` in
  `apps/cli/src/services/cache/stream-resolve-cache.ts` derives its preimage from the
  manifest `keyParts`, which carry no `apiRoute`. Read, write, and invalidation all
  use that one key, so they cannot disagree. A stale entry whose route later dies is
  caught by the cache-revalidation stream-health probe, not by key fragmentation.
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

### Miruro pipe contract

Miruro resolves entirely through `GET /api/secure/pipe?e=…` on `www.miruro.bz` and
`www.miruro.ru`. `packages/providers/src/miruro/direct.ts` owns the whole path.

- **Server order has one authority.** `MIRURO_SERVER_TRY_ORDER` in
  `packages/providers/src/miruro/manifest.ts` is the only list: `kiwi`, `pewe`, `bee`,
  `hop`, `moo`, `dune`, `ANIMEKAI`, `ANIMEZ`, `ZORO`, `ally`, `bonk`. Discovery
  ranking, fallback construction when the pipe returns no provider map, and the
  known-catalog placeholder rows all read it. `kiwi` leads because its uwucdn/owocdn
  CDN serves real video; `bonk` is last because its `ibyteimg.com` CDN returns PNG
  placeholders for segments. Unknown discovered servers keep their source order
  behind every known one.
- **Identity is strict.** `resolveMiruroAnilistId()` is the single reader for both
  `listEpisodes()` and `resolve()`. It accepts an explicit `title.anilistId` or an
  exact `anilist:` prefix, each of which must be a complete positive decimal. Bare
  numeric ids, padded ids, `anilist: 438631`, `438631abc`, zero, negatives, and
  other catalogs' ids all fail closed rather than reaching the API as a query that
  comes back as an unexplained empty catalog.
- **Reachability is not asserted without evidence.** `createMiruroResultFromPayload()`
  sets `streamReachabilityVerified: true` only when it is handed a
  `StreamReachabilityProbeResult` with `status: "reachable"`. The production resolve
  path performs no such probe, so it emits no attestation and the CLI's own
  stream-health gate probes normally. A raw URL, a decoded playlist, or a non-empty
  candidate list is not reachability evidence.
- **Pipe decoding is endpoint-aware and every stage has its own code.**
  `decodeMiruroPipePayload({ body, obfuscationVersion, expectedKind, keyHex })` raises
  `MiruroPipeDecodeError` with one of `pipe-key-missing`, `pipe-version-mismatch`,
  `pipe-base64-invalid`, `pipe-xor-gunzip-failed`, `pipe-json-syntax-invalid`, or
  `pipe-json-shape-invalid`. The error message is the code and nothing else — key
  hex, encrypted body, decrypted plaintext, and native parser messages never reach a
  log line. A decode failure aborts immediately instead of trying the next mirror
  (every mirror would fail identically) and surfaces as `parse-failed`, not
  `network-error`. A Cloudflare block surfaces as `blocked`.
- **A rotated key does not announce itself.** XOR always "succeeds", so a wrong key
  surfaces at whichever later stage its garbage breaks — `pipe-xor-gunzip-failed` on a
  gzipped body, `pipe-json-syntax-invalid` on a plain one. Both are actionable;
  neither is silent.
- **The obfuscation version-2 body prefix only marks gzipped payloads.**
  `bh4YNPj7` is `base64url(xor(gzipHeader, key))`, so plain bodies still need the
  `x-obfuscated: 2` response header to be recognised.
- **The key is static and stays static.** `PIPE_KEY` is a documented constant. No
  first-party or reproducible derivation source has been demonstrated, so Kunai does
  not scrape or guess one at runtime. Re-derivation stays a separate provider-intake
  investigation, gated on a documented first-party script/bootstrap source.
- **Subtitle format comes from evidence.** `inferSubtitleFormat()` in
  `packages/providers/src/shared/subtitle-helpers.ts` strips query and fragment,
  accepts `.vtt` / `.srt` / `.ass` / `.ssa`, honours known content types, and returns
  `unknown` otherwise. A non-VTT track is never assumed to be SRT.
- **The WAF fail-fast threshold of 2 is deliberate, not a defect.** It equals the real
  mirror count (`www.miruro.bz` + `www.miruro.ru`); when both return Cloudflare HTML
  the block is region-wide and further candidates fail identically. Changing it needs
  a reproducible failure sequence, not a guess. The block message names the one
  escape hatch that exists — a user-owned relay (`providerRelay.baseUrl`) in an
  ungated region; as of 2026-08-17 the `curl --http2` fallback is itself CF-403'd
  from some networks, so the hint is the actionable part of the failure.
  Verified live the same day: a relay deployed on Vercel `iad1` receives the
  "Just a moment" challenge on the pipe too, so that region does **not** count
  as ungated for Miruro — only a relay on an egress Miruro's WAF tolerates
  (unproven region, likely non-US cloud IPs) would clear the gate.
- **The pipe itself is fingerprint-gated, not dead.** From a real browser the
  envelope (`?e=base64url({path,method,query,body,version})`, e.g.
  `{"path":"episodes","query":{"anilistId":"21"},"version":"0.2.0"}`) answers
  200 with `x-obfuscated: 2` while plain curl gets CF HTML — intermittent by
  network. The curl fallback now reuses the AniDB curl-impersonate candidate
  list (`shared/curl-impersonate.ts`): with `curl_chrome136`/`curl_firefox135`
  installed, the pipe request carries a browser TLS fingerprint and clears the
  gate. Without an impersonate build, a WAF 403 is expected behavior, not a bug.
- **Per-server failures are not provider failures.** Miruro's site marks single
  servers under maintenance ("Some servers are under maintenance. Please switch
  servers if needed.") while others keep working. Kunai mirrors that: after the
  pipe resolves, each server is attempted as its own source candidate
  (`source:miruro:pipe:<server>:<audio>`), and a failed candidate moves to the
  next server in `MIRURO_SERVER_TRY_ORDER` instead of exhausting the provider.
- **Live evidence is the smoke's job.** `bun run test:live:miruro` resolves through
  `container.engine.resolve(...)`, probes the selected stream itself, and reports
  `streamReachable` and `resolverAttestedReachable` separately. It passes on measured
  reachability, so a resolver that correctly declines to attest still passes.

### Episode metadata ownership

Default hot path prefers provider-native episode titles:

- **Miruro** — pipe `episodes` entries (title, description, image, airDate). When ≥80% of catalog episodes have titles after merge, AniList/Jikan enrichment is skipped.
- **AllAnime** — resolve-time `tobeparsed` `episodeInfo` seeds a per-show cache; `listEpisodes` uses seeded metadata when coverage is sufficient, otherwise falls back to AniList/Jikan via `fetchAnimeEpisodeMetadataByNumber` (deprecated for default hot path, kept for sparse catalogs and filler/recap flags).

All active providers implement `CoreProviderModule` with `resolve(input, context) → ProviderResolveResult`. Resolution flows through `ProviderEngine` which handles retry, timeout, and fallback. Candidate providers can live in `packages/providers` or `.reference/experiments`, but they are not registered in `apps/cli/src/container/bootstrap-providers.ts` until they pass the quality gate.

`vidking` remains accepted as a legacy config/cache alias for `videasy`.

Legacy Playwright providers live under `.archive/legacy/apps/cli/src/providers/` as reference-only code.
For current beta publish scope, Playwright is not a required runtime dependency.

## User Overrides

There are none. A `providers.json` override file was documented here with a
worked example, but no code ever read it — writing that file did nothing, and
the example named providers (`cineby`, `vidking`) that are quarantined or
aliased today. The reserved path was removed along with this section rather
than left as a declaration with no reader.

Provider base domains are compiled in; change one by editing its manifest under
`packages/providers/src/allmanga/manifest.ts` and rebuilding. A user-owned relay
(`providerRelay.baseUrl`) is the supported way to reach a provider from a
different network path.
