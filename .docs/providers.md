# Kunai — Provider Guide

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
- `@kunai/providers` — supported direct-provider modules (`vidlink`, `rivestream`, `vidking`, `allmanga`, `miruro`) plus research/candidate modules kept out of the production resolver until they pass the provider quality gate. Modules implement `CoreProviderModule` + shared helpers (`resolve-helpers.ts`, `subtitle-helpers.ts`, `source-inventory.ts`, `direct-stream-source.ts`) + manifests co-located with modules.
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

Provider priority is user-configurable:

- `provider` / `animeProvider` remain the default provider for a new session mode.
- `providerPriority` controls movie/series fallback and picker order.
- `animeProviderPriority` controls anime fallback and picker order.
- Priority lists are applied when the provider engine is built at startup.
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
- **Tracks sub/dub rows:** only when provider trace emits `inventory:audio-modes` with both modes confirmed (AllManga does this when the catalog exposes sub and dub episode lists).

Source inventory and language normalization:

- Use `packages/providers/src/shared/source-inventory.ts` for stable source,
  stream, and variant IDs, quality normalization/ranking, source evidence, and
  stream-to-source/variant projection.
- Use strict ISO language fields for public stream/subtitle language data.
  Provider labels such as `Vietsub`, `H-SUB`, `HindiCast`, `FlowCast`, or
  site-specific server names belong in evidence/metadata, not in primary
  language fields.
- VidKing and Rivestream use the shared helpers for series/movie source
  inventory. AllManga and Miruro already expose anime-specific sub/dub/hardsub
  evidence and should be moved further only when the provider hierarchy is kept
  intact.
- UI handoff rules live in
  [.docs/source-inventory-ui-handoff.md](./source-inventory-ui-handoff.md).

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

### `ApiProvider`

Use this when metadata or stream URLs can be resolved over HTTP/GraphQL, with optional Playwright help for the last embed step.

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

`opts.embedScraper` is a legacy pattern kept for archival/reference providers. Active beta providers resolve through direct module adapters in `apps/cli/src/services/providers/definitions/`.

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
- Register the module in `apps/cli/src/container.ts` — the `createProviderEngine()` call
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

Use `apps/experiments/scratchpads/provider-*` as the research lab. The reports and probes there are evidence for dossiers and implementation handoffs, not production imports.

## Migration Order From Current Dossiers

The current Provider SDK migration follows the updated dossiers, not the older legacy provider classes:

1. `vidlink` and `rivestream`: primary low-friction movie/series lane for fast CLI startup, broad catalog coverage, and subtitle-rich playback.
2. `vidking`: high-value Videasy source lane; first-class when a valid attended Videasy session exists, but never a cold-start blocker.
3. `allanime` / AllManga-compatible client and `miruro`: active anime lane. Keep AllManga aligned with ani-cli parity and harden Miruro through the provider matrix because it exposes useful anime-native source variants, subtitles, seek thumbnails, and intro/outro facts over direct HTTP.
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
4. Register the module in `apps/cli/src/container.ts` inside the `providerModules` array passed to `createProviderEngine`

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
5. Register the module in `apps/cli/src/container.ts` via `createProviderEngine({ modules: [...] })`

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
  - `tobeparsed` decoding behavior
  - source-name inventory and ranking
  - downstream link extraction from decoded source URLs

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

Active providers are registered in `apps/cli/src/container.ts` via `createProviderEngine({ modules: [...] })`.

| ID           | Content Types | Runtime     | Module Location                               |
| ------------ | ------------- | ----------- | --------------------------------------------- |
| `vidlink`    | movie, series | direct-http | `packages/providers/src/vidlink/direct.ts`    |
| `rivestream` | movie, series | direct-http | `packages/providers/src/rivestream/direct.ts` |
| `vidking`    | movie, series | direct-http | `packages/providers/src/vidking/direct.ts`    |
| `allanime`   | anime, series | direct-http | `packages/providers/src/allmanga/direct.ts`   |
| `miruro`     | anime         | direct-http | `packages/providers/src/miruro/direct.ts`     |

All active providers implement `CoreProviderModule` with `resolve(input, context) → ProviderResolveResult`. Resolution flows through `ProviderEngine` which handles retry, timeout, and fallback. Candidate providers can live in `packages/providers` or `apps/experiments`, but they are not registered in `apps/cli/src/container.ts` until they pass the quality gate.

Legacy Playwright providers live under `archive/legacy/apps/cli/src/providers/` as reference-only code.
For current beta publish scope, Playwright is not a required runtime dependency.

## User Overrides

Users can override provider base domains through `~/.config/kunai/providers.json`.

```json
{
  "vidking": "https://mirror.example",
  "cineby": "https://alt.example"
}
```

Any provider URL construction should remain compatible with these overrides.
