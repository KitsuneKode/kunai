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
- `@kunai/providers` — 4 provider modules (`allmanga`, `miruro`, `rivestream`, `vidking`) each implementing `CoreProviderModule` + shared helpers (`resolve-helpers.ts`, `subtitle-helpers.ts`) + manifests co-located with modules
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

Subtitle policy:

- config chooses the default subtitle language
- providers expose every usable subtitle candidate they found
- playback should attach all usable subtitle tracks to mpv when possible so users can switch without restarting
- missing subtitles should be explicit trace/diagnostic information, not a silent absence

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

1. `vidking` first: production direct Videasy payload/decryption path in the active beta runtime.
2. `allanime` / AllManga-compatible client second: production GraphQL/AES client with ani-cli parity discipline.
3. `rivestream` and `miruro` next: candidate 0-RAM providers proven in scratchpads, pending fixtures.
4. `anikai` after the runtime-browser package: it needs harvest-and-fetch/JIT Playwright boundaries.
5. `braflix`, `cineby`, `bitcine`, and `cineby-anime` remain fallback/reference paths unless new research proves they are better than the direct routes.

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
4. Register the provider in `apps/cli/src/services/providers/definitions/index.ts`

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
import { createProviderCachePolicy, createResolveTrace, createTraceStep, type CoreProviderModule } from "@kunai/core";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import type { ProviderResolveInput, ProviderResolveResult, ProviderRuntimeContext } from "@kunai/types";

export const myProviderModule: CoreProviderModule = {
  providerId: "myprovider",
  manifest: myProviderManifest,
  async resolve(input, context) {
    // Validate input
    if (!input.allowedRuntimes.includes("direct-http")) {
      return createExhaustedResult(input, context, "myprovider", { code: "runtime-missing", message: "...", retryable: false });
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

| ID           | Content Types        | Runtime    | Module Location |
| ------------ | -------------------- | ---------- | --------------- |
| `rivestream` | movie, series        | direct-http | `packages/providers/src/rivestream/direct.ts` |
| `vidking`    | movie, series        | direct-http | `packages/providers/src/vidking/direct.ts` |
| `allanime`   | anime, series        | direct-http | `packages/providers/src/allmanga/direct.ts` |
| `miruro`     | anime                | direct-http | `packages/providers/src/miruro/direct.ts` |

All 4 providers implement `CoreProviderModule` with `resolve(input, context) → ProviderResolveResult`. Resolution flows through `ProviderEngine` which handles retry, timeout, and fallback.

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
