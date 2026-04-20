# KitsuneSnipe — Architecture

Use this doc when changing flow control, playback lifecycle, provider orchestration, persistence, or any code that affects recovery behavior. It exists to explain why the shape is the way it is, not to script every implementation choice.

## System Shape

KitsuneSnipe is a terminal CLI that:

1. Searches titles
2. Lets the user pick a title, season, episode, and provider
3. Resolves a playable stream URL
4. Launches `mpv`
5. Returns to a post-playback menu that can continue playback or jump back to search

```text
user input -> search -> picker -> provider resolve -> Playwright/API stream capture -> mpv -> menu
```

## Control Flow

`index.ts` owns two nested loops:

```ts
while (true) {
  searchAndPickTitle();

  while (!backToSearch) {
    resolveStream();
    playInMpv();
    openPostEpisodeMenu();
  }
}
```

This split is intentional because it preserves a clean boundary between search state and playback state.

- The outer loop owns title/mode selection
- The inner loop owns playback continuity
- `[a]` breaks the inner loop so anime/series mode can switch without restarting the process
- CLI bootstrap flags apply on the first outer-loop pass only

## Runtime Modules

| Area                  | Files                                             | Responsibility                                                             |
| --------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| Entry + orchestration | `index.ts`                                        | Search loop, playback loop, provider selection, handoff between subsystems |
| Search                | `src/search.ts`, `src/tmdb.ts`, `src/ui.ts`       | Search backends plus season/episode pickers                                |
| Scraping              | `src/scraper.ts`                                  | Browser automation and network interception                                |
| Playback              | `src/mpv.ts`, `src/menu.ts`                       | `mpv` launch, Lua-assisted progress tracking, post-playback actions        |
| Persistence           | `src/config.ts`, `src/history.ts`, `src/cache.ts` | Config, watch progress, stream cache                                       |
| Providers             | `src/providers/*`                                 | Stream-source-specific resolution logic                                    |
| Terminal UI           | `src/design.ts`, `src/menu.ts`, `src/image.ts`    | ANSI presentation, status lines, posters                                   |
| Observability         | `src/logger.ts`                                   | Structured debug logs                                                      |

## Provider Model

There are two provider families:

- `PlaywrightProvider`: constructs an embed URL and lets `scraper.ts` intercept the stream
- `ApiProvider`: resolves metadata or stream URLs over HTTP/GraphQL and can delegate the final embed step through `embedScraper`

`src/providers/index.ts` is the single registry source of truth:

- `PROVIDERS`
- `PLAYWRIGHT_PROVIDERS`
- `ANIME_PROVIDERS`

Use [.docs/providers.md](.docs/providers.md) for provider-specific details.

## Why Key Decisions Exist

| Decision                     | Reason                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| Playwright over direct fetch | JS-driven players hide the real `.m3u8` until runtime                                   |
| Detached `mpv`               | Keeps the terminal usable and matches ani-cli style behavior                            |
| Lua position reporter        | `mpv` does not reliably expose final playback position on exit                          |
| Injected `embedScraper`      | Lets API providers reuse Playwright scraping without circular imports                   |
| Search-service registry      | Keeps room for multiple search backends without hardwiring everything into one provider |
| `isAnimeProvider` flag       | Anime routing should be explicit and cheap to evaluate                                  |

## Critical Invariants

### Provider and anime invariants

- `isAnimeProvider: true` is what includes a provider in anime mode
- Episode numbering in the UI is always 1-based
- `anime-base.ts` should stay aligned with ani-cli assumptions unless the codebase deliberately chooses a new contract

### AllAnime invariants

- `KNOWN_SOURCES = ["Default", "Yt-mp4", "S-mp4", "Luf-Mp4"]`
- `hexDecode` mirrors ani-cli provider decoding logic
- AES mode is `AES-256-CTR`
- Key source is `SHA-256("SimtVuagFbGR2K7P")`
- IV is derived from the first 12 bytes of the provider blob
- `counter[15] = 2`
- `countryOrigin: "ALL"` is required for broad search coverage
- `tobeparsed` stays out of the GraphQL selection set
- `m3u8Referer` comes from the JSON response body, not the static config referer

## Playback and Recovery

### Scraper flow

`src/scraper.ts`:

1. launches Chromium
2. listens for stream and subtitle requests
3. loads the provider page
4. performs an optional click for providers that need activation
5. waits for stream capture, then subtitles

### `mpv` flow

`src/mpv.ts`:

- launches `mpv` detached
- writes playback position through a Lua helper
- polls the position file after exit
- has a deadline to avoid hanging forever if `mpv` dies badly

This is part of the repo's reliability contract. Changes are fine, but recovery under kill signals, EOF, or expired stream URLs needs to remain solid.

Observability matters here too: failures around stream resolution, cache reuse, or provider retries should leave enough logging context to explain what path the app took.

## Persistence and Data Ownership

| Data               | Path                                       | Owner            |
| ------------------ | ------------------------------------------ | ---------------- |
| Config             | `~/.config/kitsunesnipe/config.json`       | `src/config.ts`  |
| Provider overrides | `~/.config/kitsunesnipe/providers.json`    | `src/config.ts`  |
| Watch history      | `~/.local/share/kitsunesnipe/history.json` | `src/history.ts` |
| Stream cache       | `./stream_cache.json`                      | `src/cache.ts`   |
| Debug logs         | `./logs.txt`                               | `src/logger.ts`  |

Known caveat: the stream cache TTL is longer than some upstream token lifetimes, especially AllAnime-backed URLs.

## External Services

| Service                | Purpose                             |
| ---------------------- | ----------------------------------- |
| `db.videasy.net`       | TMDB-format search and season proxy |
| `api.themoviedb.org`   | fallback season metadata            |
| `api.allanime.day`     | AllAnime GraphQL                    |
| `anime-db.videasy.net` | HiAnime search                      |
| `sub.wyzie.io`         | subtitle lookup                     |
| `image.tmdb.org`       | poster images                       |
