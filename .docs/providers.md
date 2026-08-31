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
config without modifying it, preflights `/health` with Bun's own fetch path, and
then launches the same isolated AllAnime smoke profile. It logs only the relay
origin, token presence, health provider count, and a bounded network failure
code. Explicit `KUNAI_RELAY_*` values still override stored values.

Use `apps/relay-server/README.md` for Vercel deployment and security notes.

### Endpoint quarantine (dead mirrors)

Providers share a persisted endpoint-health gate on `ProviderRuntimeContext.endpointHealth`:

- **route-dead** (HTTP 404/410): quarantine ~24h in `provider_endpoint_health` (cache DB).
- **server-error** (persistent 5xx): quarantine ~1h, triggered by failures across ≥2 distinct titles **or** ≥3 consecutive failures on a single title. The single-title trigger exists because normal viewing stays on one title, so the distinct-title rule alone never fired in practice. A success clears the streak.
- **transient** (timeout/network): in-memory cooldown only; never persisted.

`runProviderCycle` skips quarantined candidates (`source:skipped`, reason `quarantined`) and records failures/successes by class. Videasy seeds deprecated routes (`1movies`, Sanji) into the gate; runtime quarantine can still learn new dead endpoints. A pinned title source is cleared when its endpoint is quarantined. Resolve-gate stream probes allow slow CDN timeouts (unverified) but fail on definitive 4xx/5xx; playback preflight re-resolves the same provider once with `intent: "refresh"` before cross-provider fallback.

**Every 4xx is definitive at the resolve gate.** `isDefinitiveHttpStatus` in
`packages/providers/src/shared/stream-reachability.ts` treats the whole 4xx range
as a refusal. 429 was briefly excluded on the theory that a CDN throttling a CLI
probe says nothing about playback; live testing on 2026-08-24 disproved it —
VidLink's CDN answers 429 to GET, HEAD and ranged GET alike on every candidate,
so passing the gate only handed mpv a 587-byte nginx error page. Failing here is
what lets a working provider take over. Any future exception needs evidence that
the stream _plays_, not merely that a probe passed.

**The gate walks candidates, it does not judge one.** `resolveDirectStreamSource`
probes up to `RESOLVE_GATE_MAX_PROBES` ranked candidates and takes the first that
answers, so one dead or hotlink-protected URL no longer condemns its working
siblings. It stops immediately when `context.signal` aborts — a cancelled resolve
keeps its selection rather than recording a stream failure.

**VidLink needs the browser playback environment (2026-08-24).** Without an
`x-playback-environment` header, `vidlink.pro/api/b` answers with
`deliveryType: "file"` — direct MP4s on `bcdn.hakunaymatata.com` flagged
`requiresProxy`, which return 429 to every non-browser client and 403 with no
referer. Sending `webkit` switches delivery to a DASH manifest on
`sacdn.hakunaymatata.com`, and the CloudFront cookies that authorise it arrive
in `stream.playlistHeaders`. That cookie has to reach the manifest fetch, the
segment fetches, and the resolve-gate probe; without it the host answers 403.
Verified end to end with mpv decoding frames for both a movie and an episode.

Two consequences worth keeping in mind. The signed cookie carries `TTL: 3600`,
so a cached resolve older than an hour will 403 on replay. And mpv only has
dedicated options for referer and user-agent — everything else a provider
attaches has to ride `http-header-fields`, which is why
`normalizeStreamHttpHeaders` forwards unknown headers instead of dropping them.

**Per-candidate timeouts are clamped to the attempt budget.**
`providerCycleCandidateTimeoutMs` (in `packages/core/src/provider-attempt-budget.ts`)
holds a provider's chosen `candidateTimeoutMs` below the attempt timeout it runs
inside. Miruro and Videasy both requested 20s inside a 12s `balanced` attempt, so
the bound was unreachable and one hung mirror consumed the whole attempt with
nothing attributable in the trace. Providers still pick their own value: Miruro
wants a short bound so it can walk past a blocked mirror, Videasy wants a slow
flavor to finish.

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
- **Language seam:** `mediaLanguageProfileFor` (via `playback-profile-context`) supplies audio/subtitle/quality for resolve, prefetch, cache keys, and mpv handoff. Anime audio intent uses `resolveAnimeAudioIntent` (`original`/`ja` → sub catalog, `en`/`dub` → dub catalog). Miruro walks its fallback audio when the requested one has no working server; that downgrade now emits an `audio:fallback` trace event (requested vs resolved) so the shell can surface it, rather than silently swapping a dub for a sub. AniDB keeps its documented no-fallback contract — it fails closed on the requested mode.
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

### YouTube (`packages/providers/src/youtube`)

**The quality ceiling reaches mpv only if three things are right.** Verified
against mpv 0.41 over the real IPC socket:

- `ytdl` is a yes/no flag, `ytdl-format` is the selector. The persistent loadfile
  path assigned the selector to the flag; mpv answered `error: "success"` and
  ignored it, so a `height<=144` request played 720p.
- `script-opts` cannot be set per file. With `mpv-ytdlautoformat` installed it
  overrides Kunai's `ytdl-format` unless `ytdlautoformat-domains=` is in the
  launch args, so a persistent session always carries that guard — it may be
  handed a YouTube URL over IPC long after launch.
- `--ytdl=no` is process-wide and a later per-file `ytdl: "yes"` cannot lift it.
  A persistent session launched on an HLS stream therefore could not play
  YouTube at all afterwards; mpv reported the load as successful and produced no
  video. That flag is now one-shot only, and the persistent path disables ytdl
  per file instead.

**A failed metadata probe is classified, not swallowed.**
`classifyYoutubeMetadataFailure` (`youtube/metadata-failure.ts`) splits yt-dlp
stderr into terminal and transient. Terminal — private, deleted, members-only,
age-gated, geo-blocked — fails the lane closed with the real reason. Every
failure used to collapse into one retryable `parse-failed` while resolve still
returned `status: "resolved"` with the bare watch URL, so nothing fell back and
playback died inside mpv with no diagnosis near the cause. Transient failures
(network, 429, timeout) still resolve, because a flaky probe must not destroy a
working playback path; those streams carry `metadataUnavailable: true`.

**A quality preference is a ceiling, not a wish.** `selectYoutubeQuality`
(`youtube/quality-selection.ts`) rounds _down_ to the highest rendition at or
below the requested height. The old selector did an exact label match and fell
back to `qualityLabels[0]` — a list sorted highest-first — so asking for 720p on
a video publishing only 1080p and 480p silently returned 1080p. When metadata is
unavailable the requested label is still used to build the yt-dlp format
selector, so the cap survives a failed probe instead of becoming `best`.

**The Invidious registry lookup is bounded.** It was the only fetch on the search
path without its own timeout, so a hung registry stalled search before any
instance was tried. It now carries a short deadline and falls back to the last
known pool when the registry is slow or broken — an expired directory still
names instances that work. Instance order is left as the registry returns it
(`sort_by=type,health,api`), so the first entry is the healthiest; failures
rotate via cooldown rather than round-robin, which would spread load onto less
healthy instances.

Third lane provider for standalone videos, Shorts, playlists, and channels.

- **Search/browse:** Invidious primary with instance rotation; optional Piped fallback (`config.youtubeMetadata.pipedApiUrl`); tertiary `ytsearch:` via yt-dlp when both fail (a `type:short` query leads with yt-dlp instead, see below). Badges distinguish active live streams (`● LIVE`), premieres (`Upcoming`), archived streams (`Was Live`), Shorts, playlists, and channels.
- Search results preserve a `contentShape` of `video`, `short`, `playlist`, or
  `channel`; `liveStatus` separately identifies `live`, `upcoming`, and
  `post_live`. The browse UI labels these shapes before playback, so channels,
  playlists, Shorts, and live entries cannot be mistaken for ordinary videos.
  Invidious forks that omit a shape/status signal are labelled conservatively.
  Shape comes from the provider — `is_short` or a `/shorts/` URL — never from
  duration: YouTube raised the Shorts ceiling to three minutes in October 2024,
  so a length test both mislabels brief videos and misses long Shorts.
- `type:short` is YouTube-only and runs its own search rather than filtering one.
  `ytsearch:` excludes Shorts outright — a probe of `ytsearch12:cooking` returned
  twelve entries and not one carried a Shorts signal — so filtering that lane could
  only ever empty it and then fall through to a backend that was never asked for
  Shorts either. The Shorts lane instead asks yt-dlp for YouTube's own results page
  with `sp=EgIYAQ%3D%3D`, the filter YouTube itself uses, and reads the `/shorts/`
  URLs it returns. An empty answer from that lane is authoritative ("no Shorts"),
  not a dead lane to fall through. It never relabels an unclassified video as a
  Short, and is intentionally unsupported in TMDB and AniList modes, just like the
  other YouTube content shapes.
- **Detail/quality:** `yt-dlp -J` on cache miss (SQLite `youtube_metadata_cache`, 15-minute TTL). Resolve fails with `yt-dlp-missing` when yt-dlp is absent. Default quality ceiling is **1080p** (`youtubeLanguageProfile.quality`); change under `/settings` → Language → YouTube quality. Format selector uses `bv*[height<=?H]+ba/bv*[height<=?H]/bv*+ba/b` — `bv*` (not `bv`) so pre-merged renditions stay eligible, `<=?H` so live HLS variants with no reported height are not rejected, and the ceiling repeated on the fallback so a failed merge cannot silently promote the viewer above the quality they asked for.
- **Playback:** canonical `https://www.youtube.com/watch?v=ID` with mpv `--ytdl-format` and `--ytdl-raw-options` (SponsorBlock, live edge via `no-live-from-start=`, PO tokens). Live broadcasts apply a short-buffer demuxer profile (`demuxer-readahead-secs=10`, `demuxer-max-bytes=32MiB`, `cache-pause-wait=1`) at spawn **and** on every persistent loadfile replacement — a replacement inherits nothing from spawn argv, so both paths read one shared constant. Live playback also suppresses the `--start` seek, the loadfile `start`, the watch-later resume prompt, and the in-process reconnect seek: a broadcast has no absolute position to return to. Kunai disables mpv-ytdlautoformat overrides via `--script-opts=ytdlautoformat-domains=` so a user-level `ytdlautoformat` script cannot force 720p. **No full video file is written for play** — mpv streams via yt-dlp; only JSON metadata is cached in SQLite.
- **Subtitles:** Automatically attaches all human-authored tracks, the original language track (`-orig`), and user-configured language translations while filtering out machine-translation spam and `live_chat` JSON metadata.
- **Downloads:** explicit queue via `d` / download flows; yt-dlp writes `.mp4` to `downloadPath` (or OS default) with `-f` from the same format selector, `--merge-output-format mp4`, cookies/extractor args, and optional `--sponsorblock-remove`; live streams rejected at enqueue.
- **Process output is bounded:** metadata mode caps complete stdout/stderr payloads, while download progress mode caps each incomplete output line and retains only a bounded stderr tail. A malformed or stalled yt-dlp process is terminated instead of growing an unbounded in-memory progress buffer.
- **History:** persisted as `mediaKind: "video"`; resume/continue restores youtube shell mode; playlist rows label `#N`.
- **Share:** `kunai://` links use `cat=youtube:VIDEO_ID` and `kind=video`.
- **Settings:** `/settings` → YouTube section for Invidious instance, Piped URL, cookies, extractor args, PO token, SponsorBlock categories (`config.youtubeMetadata.*`). Rebinds provider without restart.
- **Extractor args are one `youtube:` prefix.** yt-dlp strips `IE_KEY:` exactly once and splits the rest on `;`, so `youtube:a=1;youtube:b=2` parses `b` as the key `youtube:b` and the value is never read. Everything that edits these args goes through the parse/serialize pair in `packages/providers/src/youtube/ytdl-options.ts`. The default is `player_client=visionos,web`, mirroring yt-dlp's own `_DEFAULT_CLIENTS`: `visionos` is the only client with no GVS PO-token policy, and yt-dlp skips rather than attempts formats whose token is missing, so a token-gated client in front wastes a whole failover lane.
- **Diagnostics:** `/diagnostics` shows yt-dlp version and Invidious health (`youtube.ytdlp.probe`, `youtube.invidious.health` events).
- **Stats:** watch time aggregates under the `video` kind in `/stats`.
- **Dependencies:** `yt-dlp` required for playback and downloads; search can work via Invidious/Piped without it.
- **Age-restricted / members content & PO tokens:** configure `config.youtubeMetadata.cookiesFromBrowser`, `cookiesFile`, or `poToken` under `/settings` → YouTube.

## When A Browser-Requiring Source Can Become Browser-Less

Kunai ships no browser runtime, so this is a research question, not a fallback.
Do not assume every iframe or embed site can be converted into an HTTP-only
provider just because AllAnime can.

Move a provider away from Playwright only when research shows at least one of these is true:

- the page exposes a stable JSON or AJAX endpoint for servers or source links
- the embed URL can be derived deterministically without executing site JS
- the final stream request can be reproduced with normal headers and referers
- the remaining browser step is just a last-mile embed scrape, small enough to reproduce over plain HTTP

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

## Design Guidance

- If multiple providers need the same parsing, retry, or URL-construction behavior, extract it instead of copying it
- Keep provider files focused on provider-specific behavior; push shared mechanics into reusable helpers
- Preserve compatibility with provider overrides and existing registry contracts
- Providers handle provider-local mirror/source retries internally, but must emit trace events so diagnostics and UI can show what happened
- The global resolver handles provider-level fallback, ranking, cache reads/writes, health scoring, and user policy
- Providers emit cache policy and hints; they do not write SQLite, history, cache, health, or trace stores directly
- Providers receive runtime ports such as `fetch` or `browserLease`; they do not own environment-specific runtime setup

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

Dated incident history — NEED_CAPTCHA, the user-relay route, and the crypto
rotations — lives in
[provider-dossiers/allanime-parity-history.md](./provider-dossiers/allanime-parity-history.md).

`packages/providers/src/allmanga/api-client.ts` contains the crypto/decoder and GraphQL helpers shared by the `allmangaProviderModule`. The module itself (`allmanga/direct.ts`) implements `CoreProviderModule`.

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

## Capability Flags

| Field                   | Meaning                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `isAnimeProvider: true` | Include provider in anime mode                               |
| `needsClick: true`      | Scraper performs an activation click after navigation        |
| `searchBackend`         | Documents which search backend currently feeds this provider |

## Active Beta Providers

Per-provider runtime detail lives in the dossiers, not here. This section keeps
only the contracts every provider must honour.

| Provider            | Dossier                                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AllManga / AllAnime | [allmanga.md](./provider-dossiers/allmanga.md) · [allanime-parity-history.md](./provider-dossiers/allanime-parity-history.md)                                     |
| AniDB               | [anidb-runtime-contract.md](./provider-dossiers/anidb-runtime-contract.md) · [anidb-metadata-capabilities.md](./provider-dossiers/anidb-metadata-capabilities.md) |
| Miruro              | [miruro.md](./provider-dossiers/miruro.md)                                                                                                                        |
| Videasy             | [videasy.md](./provider-dossiers/videasy.md)                                                                                                                      |
| Rivestream          | [rivestream.md](./provider-dossiers/rivestream.md)                                                                                                                |
| Cineby              | [cineby.md](./provider-dossiers/cineby.md) · [cineby-anime.md](./provider-dossiers/cineby-anime.md)                                                               |

Active providers are registered in `apps/cli/src/container/bootstrap-providers.ts` via
`loadProductionProviderModules()`. A module existing under `packages/providers/src/` does not make
it live, and release signoff derives its cases from that list plus the configured lane defaults.

`anidb` is the **default** provider-native anime catalog and the first configured
anime priority (`animeProvider: "anidb"`, `animeProviderPriority: ["anidb"]`).
The priority list is ordering, not an allowlist: registered `allanime` and
`miruro` modules remain available after AniDB and are manually selectable. See
[the AllAnime parity history](./provider-dossiers/allanime-parity-history.md) and
[the Miruro dossier](./provider-dossiers/miruro.md) for their network failure
modes.

| ID           | Content Types | Runtime     | Module Location                               |
| ------------ | ------------- | ----------- | --------------------------------------------- |
| `vidlink`    | movie, series | direct-http | `packages/providers/src/vidlink/direct.ts`    |
| `rivestream` | movie, series | direct-http | `packages/providers/src/rivestream/direct.ts` |
| `videasy`    | movie, series | direct-http | `packages/providers/src/videasy/direct.ts`    |
| `anidb`      | anime         | direct-http | `packages/providers/src/anidb/direct.ts`      |
| `allanime`   | anime, series | direct-http | `packages/providers/src/allmanga/direct.ts`   |
| `miruro`     | anime         | direct-http | `packages/providers/src/miruro/direct.ts`     |
| `youtube`    | video         | direct-http | `packages/providers/src/youtube/direct.ts`    |

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
  request. AniDB keeps its separate catalog-proven routing policy in
  [its runtime contract](./provider-dossiers/anidb-runtime-contract.md).
- **AllAnime provider-native episode identity** — episode catalog rows remain
  1-based in Kunai, but each row carries its exact AllAnime string (including
  `0`, duplicate values, and `OVA` / `SP` labels) through the CLI catalog
  adapter into `EpisodeIdentity.providerEpisodeIdentity`. AllAnime uses that
  string only while it still belongs to the active catalog; requests without a
  provider catalog selection retain the season-relative / absolute numeric
  fallback. If an explicit AllAnime identity has disappeared from the current
  AllAnime catalog, resolution fails closed instead of selecting by UI index.
  The string is opaque: cache and work keys do not trim, case-fold,
  or otherwise normalize it. Active episode selection, source preference,
  prefetch/recent-stream reuse, cache invalidation, queued downloads, offline
  artifact admission, and local playback retain the same identity so an older
  row at the same UI index cannot supply the wrong stream.

A catalog's own id space is numeric, so a non-numeric id is never accepted into the `anilistId` or
`tmdbId` slot even when the active provider declares that catalog identity.

### Title identity persistence contract

History and continuation use **canonical catalog ids** as the merge key (`anilistId` for anime, `tmdb:…` for series/movie) via `resolveCanonicalCatalogTitleId()` / `resolvePersistedHistoryTitle()` in `@kunai/core`.

- **`externalIds.providerNativeIds`** — per-provider opaque show ids (e.g. AllAnime `bxCKT…`) stored in `history_progress.external_ids_json`. Written on playback upsert and backfilled immediately after anime remap (`persistProviderNativeMapping`).
- **Read path** — `HistoryRepository.getLatestForTitleIdentity()` tries the canonical id first, then falls back to the session opaque id for legacy rows.
- **AllAnime bridge** — `resolveAllMangaShowId` reads `providerNativeIds.allanime`, then the durable SQLite `provider_title_bridge` cache (TTL class `provider-metadata`), then in-process search bridge. Bridge results are persisted to both history metadata and the cache adapter injected through `ProviderRuntimeContext.titleBridge`. Numeric catalog ids fail closed when no native mapping is available: a confirmed miss is `unsupported-title`, while an unchecked bridge caused by search transport failure stays a retryable `network-error`; neither value is sent to the provider-native show catalog.
- **Legacy repair** — `HistoryIdentityConsolidator` runs once at CLI bootstrap (catalog-proof rows only; set `KUNAI_HISTORY_IDENTITY_DRY_RUN=1` to log without writing). Continue-watching dedupes display rows by catalog id without DB writes.

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
