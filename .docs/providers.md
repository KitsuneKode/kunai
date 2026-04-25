# KitsuneSnipe — Provider Guide

Use this doc when adding a provider, changing provider capabilities, or debugging stream resolution. It should explain the current contracts clearly without over-prescribing implementation style.

For new providers and major provider rewrites, start with the intake workflow in [.docs/provider-intake.md](./provider-intake.md) before writing scraper code. Provider work should produce a dossier first when the shape of the site is not already well understood.

For concrete example patterns and demo provider shapes, use [.docs/provider-examples.md](./provider-examples.md).

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

`opts.embedScraper` is injected from `index.ts` so providers can reuse Playwright scraping without importing `scraper.ts` directly.

## When A Playwright Provider Can Become Browser-Less

Do not assume every iframe or embed site can be converted into an HTTP-only provider just because AllAnime can.

Move a provider away from Playwright only when research shows at least one of these is true:

- the page exposes a stable JSON or AJAX endpoint for servers or source links
- the embed URL can be derived deterministically without executing site JS
- the final stream request can be reproduced with normal headers and referers
- the remaining browser step is just a last-mile embed scrape, which fits the hybrid `ApiProvider + embedScraper` pattern

Keep Playwright when the real stream only appears after runtime JS, player boot code, anti-bot challenges, or click-driven state that cannot be reproduced cheaply and reliably over plain HTTP.

## Registration

- Add the implementation under `src/providers/`
- Register it in `src/providers/index.ts`
- Treat `src/providers/index.ts` as the source of truth for available providers

## Workflow Reminder

Provider implementation is not the same thing as provider research.

Use:

- [.docs/provider-intake.md](./provider-intake.md) for the dossier-first research flow
- [.docs/provider-agent-workflow.md](./provider-agent-workflow.md) for repo-local agent instructions
- [.docs/provider-examples.md](./provider-examples.md) for concrete implementation patterns
- [.plans/provider-hardening.md](../.plans/provider-hardening.md) for the broader hardening roadmap

When the site behavior is unclear, gather evidence first and keep knowns vs unknowns separate.

## Design Guidance

- If multiple providers need the same parsing, retry, or URL-construction behavior, extract it instead of copying it
- Keep provider files focused on provider-specific behavior; push shared mechanics into reusable helpers
- Preserve compatibility with provider overrides and existing registry contracts

## Adding a Playwright Provider

1. Implement `PlaywrightProvider`
2. Return a stable embed URL from `buildUrl()`
3. Set `needsClick: true` only if playback requires user activation
4. Register the provider in `src/providers/index.ts`

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

## Adding an API Provider

1. Implement `search()` if the provider owns a search backend today
2. Implement `resolveStream()`
3. Use `opts.embedScraper()` if the last step still needs a browser
4. Register the provider in `src/providers/index.ts`

Minimal shape:

```ts
export const MyApiProvider: ApiProvider = {
  kind: "api",
  id: "myapi",
  description: "HTTP-first provider",

  async search(query) {
    return [];
  },

  async resolveStream(id, type, season, episode, opts) {
    return opts.embedScraper(`https://example.com/embed/${id}`);
  },
};
```

## Adding an AllAnime-Compatible Provider

If the provider follows the same contract as `allanime-family.ts`, use `createAnimeProvider()` instead of reimplementing the crypto and decoder path.

```ts
export const MyAnime = createAnimeProvider({
  id: "myanime",
  description: "Alternative AllAnime endpoint",
  apiUrl: "https://example.com/api",
  referer: "https://example.com/",
  isAnimeProvider: true,
});
```

## AllAnime / AllManga Parity Policy

- `src/providers/allanime-family.ts` should stay aligned with ani-cli behavior unless KitsuneSnipe deliberately chooses a different contract
- when AllAnime or AllManga breaks, compare against ani-cli before guessing at a fix
- on this machine, the canonical local ani-cli checkout is `~/Projects/osc/ani-cli`
- if ani-cli is also broken upstream, KitsuneSnipe may carry a temporary local fix, but that divergence should be documented and easy to remove when parity can be restored
- this is a family-specific reference contract for AllAnime-compatible providers, not the default contract for every anime source
- when fixing this family of providers, check:
  - search GraphQL query shape
  - episode list query shape
  - `tobeparsed` decoding behavior
  - source-name inventory and ranking
  - downstream link extraction from decoded source URLs

Recommended workflow:

1. compare behavior with the local ani-cli checkout
2. identify whether the break is shared upstream or KitsuneSnipe-specific
3. if shared upstream, implement the smallest temporary local fix needed here
4. document the divergence and what should be removed once upstream parity is restored

## Capability Flags

| Field                   | Meaning                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `isAnimeProvider: true` | Include provider in anime mode                               |
| `needsClick: true`      | Scraper performs an activation click after navigation        |
| `searchBackend`         | Documents which search backend currently feeds this provider |

## Current Providers

| ID             | Kind       | Notes                                  |
| -------------- | ---------- | -------------------------------------- |
| `vidking`      | Playwright | Primary movie/series provider          |
| `cineby`       | Playwright | Needs click                            |
| `bitcine`      | Playwright | Similar to Cineby                      |
| `braflix`      | API        | HTTP metadata plus embed scrape        |
| `allanime`     | API        | ani-cli parity logic                   |
| `cineby-anime` | API        | HiAnime search plus anime embed scrape |

## User Overrides

Users can override provider base domains through `~/.config/kitsunesnipe/providers.json`.

```json
{
  "vidking": "https://mirror.example",
  "cineby": "https://alt.example"
}
```

Any provider URL construction should remain compatible with these overrides.
