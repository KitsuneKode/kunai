# KitsuneSnipe — Runtime Architecture

Use this doc first when changing flow control, playback lifecycle, provider orchestration, persistence, or any code that affects recovery behavior.

This is the canonical architecture entry doc. It explains:

- the current production runtime shape
- the boundaries that already exist and should not be broken casually
- where to read next depending on whether you are fixing current behavior or implementing the persistent-shell target

Read next:

- current runtime and invariants: this file
- target runtime direction: [.docs/architecture-v2.md](./architecture-v2.md)
- shell and interaction model: [.docs/ux-architecture.md](./ux-architecture.md)
- implementation sequencing: [.plans/persistent-shell-implementation.md](../.plans/persistent-shell-implementation.md)

## System Shape

KitsuneSnipe is a terminal CLI that:

1. Searches titles
2. Lets the user pick a title, season, episode, and provider
3. Resolves a playable stream URL
4. Launches `mpv`
5. Returns to the same shell for post-playback actions, settings, and provider changes

```text
user input -> Ink shell -> picker -> provider resolve -> Playwright/API stream capture -> mpv -> shell
```

## Current vs Target

There are currently two architectural truths that must be kept distinct:

- `index.ts` is still the live legacy runtime path for the current CLI loop
- `src/main.ts` is the target entrypoint for the persistent-shell architecture

Do not mix these mentally.

When fixing current behavior:

- preserve the existing nested-loop guarantees unless the task explicitly includes migration work

When implementing the new shell:

- treat `src/main.ts` and the v2 docs as the target source of truth
- reduce `index.ts` toward shim or legacy status instead of evolving both paths in parallel

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

This remains the current runtime contract until the persistent-shell migration completes.

## Runtime Modules

| Area                  | Files                                             | Responsibility                                                             |
| --------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| Entry + orchestration | `index.ts`                                        | Search loop, playback loop, provider selection, handoff between subsystems |
| Shell UI              | `src/app-shell/*`, `src/session-flow.ts`          | Ink shell, commands, settings, history, and structured pickers             |
| Search                | `src/search.ts`, `src/tmdb.ts`, `src/ui.ts`       | Search backends, metadata fetches, and dependency checks                   |
| Scraping              | `src/scraper.ts`                                  | Browser automation and network interception                                |
| Playback              | `src/mpv.ts`                                      | `mpv` launch and Lua-assisted progress tracking                            |
| Persistence           | `src/config.ts`, `src/history.ts`, `src/cache.ts` | Config, watch progress, stream cache                                       |
| Providers             | `src/providers/*`                                 | Stream-source-specific resolution logic                                    |
| Terminal UI           | `src/design.ts`, `src/menu.ts`, `src/image.ts`    | Shared styling tokens, ANSI helpers, posters                               |
| Observability         | `src/logger.ts`                                   | Structured debug logs                                                      |

If your change is broad enough to blur these module boundaries, stop and check whether the work belongs in the v2 migration path instead.

## Provider Model

There are two provider families:

- `PlaywrightProvider`: constructs an embed URL and lets `scraper.ts` intercept the stream
- `ApiProvider`: resolves metadata or stream URLs over HTTP/GraphQL and can delegate the final embed step through `embedScraper`

`src/providers/index.ts` is the single registry source of truth:

- `PROVIDERS`
- `PLAYWRIGHT_PROVIDERS`
- `ANIME_PROVIDERS`

Use [.docs/providers.md](.docs/providers.md) for provider-specific details.

For new providers or major provider hardening, do not jump straight from this doc into code. Use:

- [.docs/provider-intake.md](./provider-intake.md)
- [.docs/provider-agent-workflow.md](./provider-agent-workflow.md)
- [.docs/provider-examples.md](./provider-examples.md)

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
- `allanime-family.ts` should stay aligned with ani-cli assumptions unless the codebase deliberately chooses a new contract

### AllAnime-compatible invariants

- `KNOWN_SOURCES = ["Default", "Yt-mp4", "S-mp4", "Luf-Mp4"]`
- `hexDecode` mirrors ani-cli provider decoding logic
- AES mode is `AES-256-CTR`
- Key source is `SHA-256("Xot36i3lK3:v1")`
- The current blob layout is `1-byte version prefix + 12-byte IV + ciphertext + 16-byte footer`
- IV is derived from bytes `1..12` of the provider blob
- `counter[15] = 2`
- `countryOrigin: "ALL"` is required for broad search coverage
- `tobeparsed` stays out of the GraphQL selection set
- `m3u8Referer` comes from the JSON response body, not the static config referer

This parity policy only applies to the AllAnime / AllManga API family and other deliberate compatibles. It is not a universal standard for every anime provider in the repo.

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

## Migration Guidance

If you are touching architecture during the persistent-shell rewrite, follow this rule:

- this file describes the current runtime
- `architecture-v2.md` describes the target runtime
- the implementation plan decides the order of migration

Do not silently update one without checking whether the others should also move.

## External Services

| Service                | Purpose                             |
| ---------------------- | ----------------------------------- |
| `db.videasy.net`       | TMDB-format search and season proxy |
| `api.themoviedb.org`   | fallback season metadata            |
| `api.allanime.day`     | AllAnime GraphQL                    |
| `anime-db.videasy.net` | HiAnime search                      |
| `sub.wyzie.io`         | subtitle lookup                     |
| `image.tmdb.org`       | poster images                       |
