# Kunai — Runtime Architecture

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

Kunai is a terminal CLI that:

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

- `apps/cli/src/main.ts` is now the default runnable entrypoint and the target runtime for the persistent-shell architecture
- `apps/cli/index.ts` remains only as a temporary compatibility wrapper into `apps/cli/src/main.ts`

Practical status right now:

- `apps/cli/src/main.ts` owns the DI container, config service, history store, cache store, provider registry, shared shell workflows, and the refactored search/playback phases
- package scripts and build now point at `apps/cli/src/main.ts`
- shell-local debug POST instrumentation has been removed from the Ink runtime path
- `apps/cli/index.ts` still remains runnable for old local habits, but it should not regain orchestration logic

Do not mix these mentally.

When fixing current behavior in the default runtime:

- treat `apps/cli/src/main.ts` and the v2 docs as the primary source of truth
- migrate missing behavior into `apps/cli/src/main.ts` rather than extending `apps/cli/index.ts`

## Control Flow

The old legacy two-loop runtime has been collapsed into the `apps/cli/src/main.ts` path. Preserve search/playback boundaries in the new state-driven runtime instead of reviving a second entrypoint.

## Runtime Modules

| Area                  | Files                                             | Responsibility                                                                        |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Entry + orchestration | `apps/cli/src/main.ts`, `apps/cli/src/app/*`, `apps/cli/index.ts` wrapper | Default runtime orchestration in `apps/cli/src/main.ts`; wrapper is compatibility only |
| Shell UI              | `apps/cli/src/app-shell/*`, `apps/cli/src/session-flow.ts`               | Ink shell, commands, settings, history, and structured pickers                                  |
| Search                | `apps/cli/src/search.ts`, `apps/cli/src/tmdb.ts`, `apps/cli/src/ui.ts`    | Search backends, metadata fetches, and dependency checks                                        |
| Scraping              | `apps/cli/src/scraper.ts`                                                | Browser automation and network interception                                                     |
| Playback              | `apps/cli/src/mpv.ts`                                                    | `mpv` launch and Lua-assisted progress tracking                                                 |
| Persistence           | `apps/cli/src/config.ts`, `apps/cli/src/history.ts`                      | Config, watch progress, stream cache                                                            |
| Providers             | `apps/cli/src/services/providers/*`                                      | Stream-source-specific resolution logic                                                         |
| Terminal UI           | `apps/cli/src/design.ts`, `apps/cli/src/menu.ts`, `apps/cli/src/image.ts` | Shared styling tokens, ANSI helpers, posters                                                    |
| Observability         | `apps/cli/src/logger.ts`                                                 | Structured debug logs                                                                           |

If your change is broad enough to blur these module boundaries, stop and check whether the work belongs in the v2 migration path instead.

Diagnostics note:

- the new runtime also keeps a small in-memory diagnostics event buffer for live inspection in the diagnostics overlay
- the new runtime preserves browse search state across pre-playback cancel paths, so episode-picker escape can return to the prior result list without a fresh search
- startup mode is now part of persisted config and is applied by `apps/cli/src/main.ts` before the session loop starts
- mpv now exits normally at episode EOF; auto-next decisions happen in the playback phase so the shell can keep control of the transition
- this is currently the main developer-facing trace surface inside the shell while broader report/export work is still pending

## Provider Model

There are two provider families:

- `PlaywrightProvider`: constructs an embed URL and lets `scraper.ts` intercept the stream
- `ApiProvider`: resolves metadata or stream URLs over HTTP/GraphQL and can delegate the final embed step through `embedScraper`

`apps/cli/src/services/providers/definitions/index.ts` is the single registry source of truth:

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

`apps/cli/src/scraper.ts`:

1. launches Chromium
2. listens for stream and subtitle requests
3. loads the provider page
4. performs an optional click for providers that need activation
5. waits for stream capture, then subtitles

### `mpv` flow

`apps/cli/src/mpv.ts`:

- launches `mpv` detached
- writes playback position through a Lua helper
- polls the position file after exit
- has a deadline to avoid hanging forever if `mpv` dies badly

This is part of the repo's reliability contract. Changes are fine, but recovery under kill signals, EOF, or expired stream URLs needs to remain solid.

Observability matters here too: failures around stream resolution, cache reuse, or provider retries should leave enough logging context to explain what path the app took.

## Persistence and Data Ownership

| Data               | Path                                       | Owner            |
| ------------------ | ------------------------------------------ | ---------------- |
| Config             | `~/.config/kunai/config.json`              | `apps/cli/src/config.ts`  |
| Provider overrides | `~/.config/kunai/providers.json`           | `apps/cli/src/config.ts`  |
| Watch history      | Temporary JSON store; target `kunai-data.sqlite`   | `apps/cli/src/history.ts` |
| Stream cache       | Temporary JSON store; target `kunai-cache.sqlite`  | CLI cache store           |
| Debug logs         | `./logs.txt`                               | `apps/cli/src/logger.ts`  |

Known caveat: the current JSON history/cache stores are pre-release implementation details. The target is the SQLite storage model described in [.plans/storage-hardening.md](../.plans/storage-hardening.md), with durable history/progress in the OS app data directory and disposable cache in the OS cache directory.

Migration rule:

- do not add new architecture around repo-local `stream_cache.json`
- do not treat old JSON history/cache as a compatibility contract unless external-user support is explicitly reintroduced
- keep config and provider overrides as JSON for now

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
