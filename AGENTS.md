# KitsuneSnipe — Agent Entry Point

KitsuneSnipe is a terminal-first Bun CLI that finds playable video streams by intercepting `.m3u8` requests from embed players with Playwright and handing them off to `mpv`.

## Documentation Philosophy

- Give agents routing, topology, and hard boundaries
- Keep process overhead low and let the model reason from code
- Document only the constraints that are expensive to rediscover
- Prefer pointers to deep docs over repeating the same facts everywhere

## Core Priorities

- Runtime: use `bun`, `bunx`, `bun run`
- Reliability first
- Performance matters, but not at the cost of correctness
- Keep behavior predictable during failure, recovery, and provider churn
- Make failures diagnosable with enough logging and context to reason about them
- Avoid leaving the terminal in a broken or confusing state
- If a tradeoff is required, choose correctness and robustness over short-term convenience

## Maintainability

- Long-term maintainability is a core priority
- Before adding new functionality, check whether shared logic should be extracted
- Duplicate logic across files is a design smell and should usually be refactored
- Do not solve problems with isolated local patches when the cleaner fix is a shared abstraction
- Do not be afraid to reshape existing code when it improves the long-term design

## Read This First

- Start here for commands, routing, and repo-wide invariants
- Read [.docs/architecture.md](.docs/architecture.md) before changing loops, playback flow, scraping, caching, history, or data ownership
- Read [.docs/providers.md](.docs/providers.md) before adding or changing providers
- Read [.docs/design-system.md](.docs/design-system.md) before changing terminal UI styling or interaction patterns
- Read [.docs/quickstart.md](.docs/quickstart.md) only for setup, local run flow, and troubleshooting
- Read `.plans/*` only when you are actively working on that tracked change

## Fast Map

```text
index.ts                    entry point; outer search loop + inner playback loop
src/search.ts               search service registry and TMDB-backed search
src/scraper.ts              Playwright interception for stream/subtitle capture
src/mpv.ts                  mpv launch + Lua position reporting
src/menu.ts                 post-playback menu, raw key reads, ANSI helpers
src/ui.ts                   dependency checks and fzf-driven pickers
src/tmdb.ts                 TMDB season/episode data with proxy fallback
src/history.ts              watch history persistence
src/cache.ts                stream URL cache
src/config.ts               persisted user config + provider overrides
src/providers/*             provider implementations and registry
```

## Commands

```sh
bun run index.ts
bun run index.ts -S "Dune"
bun run index.ts -i 438631 -t movie
bun run index.ts -a
bun run index.ts --debug
```

Before finishing work:

```sh
bun tsc --noEmit
./node_modules/.bin/oxlint .
./node_modules/.bin/oxfmt --check .
```

Use `bun run test` if tests are relevant and available. Do not use `bun test` directly.

## Hard Boundaries

- `index.ts` keeps the outer search loop separate from the inner playback loop; `[a]` returns to search by breaking the inner loop
- Episode numbers are 1-based in the UI; providers adapt internally
- `src/providers/index.ts` is the single registry source of truth
- `isAnimeProvider: true` is what places a provider in anime mode
- `src/providers/anime-base.ts` contains ani-cli parity logic; check external parity before changing crypto or decoder constants
- `embedScraper` is injected to avoid circular imports between providers and `scraper.ts`

## User Data

- Config: `~/.config/kitsunesnipe/config.json`
- Provider overrides: `~/.config/kitsunesnipe/providers.json`
- History: `~/.local/share/kitsunesnipe/history.json`
- Stream cache: `./stream_cache.json`
- Logs: `./logs.txt`

## Active Planning Docs

- [.plans/roadmap.md](.plans/roadmap.md): current status and what is next
- [.plans/ink-migration.md](.plans/ink-migration.md): terminal UI rewrite plan
- [.plans/search-service.md](.plans/search-service.md): deferred search/provider decoupling
- [.plans/yt-provider.md](.plans/yt-provider.md): deferred YouTube provider research
