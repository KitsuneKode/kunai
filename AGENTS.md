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
- Read [.docs/experience-overview.md](.docs/experience-overview.md) before changing user-facing scope, disclaimers, supported/unsupported behavior, or broad product messaging
- Read [.docs/product-prd.md](.docs/product-prd.md) before broad UX or product-shape changes
- Read [.docs/engineering-guide.md](.docs/engineering-guide.md) before broad refactors, service extraction, caching changes, or implementation-structure work
- Read [.docs/ux-architecture.md](.docs/ux-architecture.md) before changing shell flow, hotkeys, overlays, diagnostics, or setup UX
- Read [.docs/providers.md](.docs/providers.md) before adding or changing providers
- Read [.docs/provider-intake.md](.docs/provider-intake.md) before researching or hardening a provider, especially for new sites or major scraper changes
- Read [.docs/provider-examples.md](.docs/provider-examples.md) before implementing a new provider shape from scratch
- Read [.docs/design-system.md](.docs/design-system.md) before changing terminal UI styling or interaction patterns
- Read [.docs/ui-redesign-playbook.md](.docs/ui-redesign-playbook.md) when doing a major shell polish or redesign pass
- Read [.docs/testing-strategy.md](.docs/testing-strategy.md) before adding tests, changing test seams, or introducing new provider/runtime behaviors
- Read [.docs/quickstart.md](.docs/quickstart.md) only for setup, local run flow, and troubleshooting
- Read `.plans/*` only when you are actively working on that tracked change

## Fast Map

```text
src/main.ts                 canonical runtime entrypoint and refactored session controller
index.ts                    legacy runtime path kept during migration and parity verification
src/app-shell/*             Ink shell, command bar, list pickers, settings/history workflows
src/search.ts               search service registry and TMDB-backed search
src/scraper.ts              Playwright interception for stream/subtitle capture
src/mpv.ts                  mpv launch + Lua position reporting
src/menu.ts                 ANSI color helpers used by logs and terminal output
src/ui.ts                   dependency checks
src/tmdb.ts                 TMDB season/episode data with proxy fallback
src/session-flow.ts         start-episode selection and provider/session flow helpers
src/history.ts              watch history persistence
src/cache.ts                stream URL cache
src/config.ts               persisted user config + provider overrides
src/providers/*             provider implementations and registry
```

## Commands

```sh
bun run src/main.ts
bun run src/main.ts -S "Dune"
bun run src/main.ts -i 438631 -t movie
bun run src/main.ts -a
bun run src/main.ts --debug
bun run link:global
```

Before finishing work:

```sh
bun run typecheck
bun run lint
bun run format
```

Use `bun run test` if tests are relevant and available. Do not use `bun test` directly.

## Hard Boundaries

- `index.ts` keeps the legacy outer search loop separate from the inner playback loop; `[a]` returns to search by breaking the inner loop
- Episode numbers are 1-based in the UI; providers adapt internally
- `src/providers/index.ts` is the single registry source of truth
- `isAnimeProvider: true` is what places a provider in anime mode
- `src/providers/allanime-family.ts` contains ani-cli parity logic; check external parity before changing crypto or decoder constants
- On this machine, the local canonical ani-cli checkout for AllAnime or AllManga parity checks is `~/Projects/osc/ani-cli`
- If AllAnime or AllManga issues arise, compare against that local ani-cli checkout first, treat it as the reference behavior until upstream is clearly unmaintained, and document any temporary local divergence in provider docs or plans
- `embedScraper` is injected to avoid circular imports between providers and `scraper.ts`

## User Data

- Config: `~/.config/kitsunesnipe/config.json`
- Provider overrides: `~/.config/kitsunesnipe/providers.json`
- History: `~/.local/share/kitsunesnipe/history.json`
- Stream cache: `./stream_cache.json`
- Logs: `./logs.txt`

## Active Planning Docs

- [.plans/roadmap.md](.plans/roadmap.md): current status and what is next
- [.plans/persistent-shell-implementation.md](.plans/persistent-shell-implementation.md): migration order for the persistent shell and canonical runtime
- [.plans/ink-migration.md](.plans/ink-migration.md): terminal UI rewrite plan
- [.plans/search-service.md](.plans/search-service.md): deferred search/provider decoupling
- [.plans/yt-provider.md](.plans/yt-provider.md): deferred YouTube provider research
- [.plans/provider-hardening.md](.plans/provider-hardening.md): provider research, hardening, and scraper capability roadmap
