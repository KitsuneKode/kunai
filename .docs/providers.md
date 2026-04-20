# KitsuneSnipe — Provider Guide

Use this doc when adding a provider, changing provider capabilities, or debugging stream resolution. It should explain the current contracts clearly without over-prescribing implementation style.

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

## Registration

- Add the implementation under `src/providers/`
- Register it in `src/providers/index.ts`
- Treat `src/providers/index.ts` as the source of truth for available providers

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

If the provider follows the same contract as `anime-base.ts`, use `createAnimeProvider()` instead of reimplementing the crypto and decoder path.

```ts
export const MyAnime = createAnimeProvider({
  id: "myanime",
  description: "Alternative AllAnime endpoint",
  apiUrl: "https://example.com/api",
  referer: "https://example.com/",
  isAnimeProvider: true,
});
```

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
