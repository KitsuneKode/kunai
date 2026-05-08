# Kunai — Agent Entry Point

Kunai is a terminal-first Bun CLI that finds playable direct-provider video streams and hands them off to `mpv`.

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

## Bun-first runtime (CLI)

- Prefer `Bun.spawn`, `Bun.which`, `Bun.connect` (Unix sockets), and `Bun.sleep` for deliberate delays on Bun-only code paths.
- Prefer `Bun.file` / `Bun.write`, or shared helpers such as [`apps/cli/src/infra/fs/atomic-write.ts`](apps/cli/src/infra/fs/atomic-write.ts) (`writeAtomicJson`), for whole-file JSON when you do not need append semantics or special permission flags.
- Prefer Node `fs` when you need append (`appendFile`), crash-safe atomic replace (temp file in the target directory + `rename`), `copyFile` with mtime checks, sync `mkdir` next to SQLite bootstrap, or tight `existsSync` / `unlink` sequences on mpv Unix socket paths.
- Prefer `setTimeout` when you need cancellable deadlines (for example mpv IPC per-command timeouts with `clearTimeout`).
- Prefer `node:crypto` synchronous hashing for small hot-path keys when async Web Crypto would add complexity without benefit.
- Do not change APIs for style alone; keep Node where behavior or cross-platform semantics are clearer.

## Read This First

- Start here for commands, routing, and repo-wide invariants
- Read [.docs/architecture.md](.docs/architecture.md) before changing loops, playback flow, scraping, caching, history, or data ownership
- Read [.docs/architecture-v2.md](.docs/architecture-v2.md) before changing target monorepo, daemon, web, desktop, package, or cache boundaries
- Read [.docs/runtime-boundary-map.md](.docs/runtime-boundary-map.md) before deciding whether work belongs in CLI app, app-shell, services, infra, providers, storage, core, or legacy
- Read [.docs/experience-overview.md](.docs/experience-overview.md) before changing user-facing scope, disclaimers, supported/unsupported behavior, or broad product messaging
- Read [.docs/product-prd.md](.docs/product-prd.md) before broad UX or product-shape changes
- Read [.docs/engineering-guide.md](.docs/engineering-guide.md) before broad refactors, service extraction, caching changes, or implementation-structure work
- Read [.docs/ux-architecture.md](.docs/ux-architecture.md) before changing shell flow, hotkeys, overlays, diagnostics, or setup UX
- Read [.docs/diagnostics-guide.md](.docs/diagnostics-guide.md) before changing debug logs, diagnostics panels, subtitle evidence, provider tracing, or playback/history troubleshooting
- Read [.docs/providers.md](.docs/providers.md) before adding or changing providers
- Read [.docs/playback-timing-and-aniskip.md](.docs/playback-timing-and-aniskip.md) before changing IntroDB/AniSkip fetch, MAL resolution, `PlaybackTimingFetchContext`, or auto-skip metadata wiring
- Read [.docs/provider-intake.md](.docs/provider-intake.md) before researching or hardening a provider, especially for new sites or major scraper changes
- Read [.docs/provider-examples.md](.docs/provider-examples.md) before implementing a new provider shape from scratch
- Read [.docs/design-system.md](.docs/design-system.md) before changing terminal UI styling or interaction patterns
- Read [.docs/ui-redesign-playbook.md](.docs/ui-redesign-playbook.md) when doing a major shell polish or redesign pass
- Read [.docs/testing-strategy.md](.docs/testing-strategy.md) before adding tests, changing test seams, or introducing new provider/runtime behaviors
- Read [.docs/repo-infrastructure.md](.docs/repo-infrastructure.md) before changing CI, Husky, lint-staged, issue templates, or PR templates
- Read [.docs/recommendations-and-discover.md](.docs/recommendations-and-discover.md) before changing `/discover`, recommendation services, or recommendation UI
- Read [.docs/presence-integrations.md](.docs/presence-integrations.md) before changing Discord Rich Presence or other social status integrations
- Read [.docs/download-offline-onboarding.md](.docs/download-offline-onboarding.md) before changing download, offline library, setup, or onboarding behavior
- Read [.docs/quickstart.md](.docs/quickstart.md) only for setup, local run flow, and troubleshooting
- Read `.plans/*` only when you are actively working on that tracked change

## Fast Map

```text
apps/cli/src/main.ts                 canonical runtime entrypoint and refactored session controller
apps/cli/index.ts                    temporary compatibility wrapper into apps/cli/src/main.ts
apps/cli/src/app-shell/*             Ink shell, command bar, list pickers, settings/history workflows
apps/cli/src/search.ts               legacy TMDB/Videasy search helper; new search routing lives in app/services
apps/cli/src/mpv.ts                  mpv launch + Lua position reporting
apps/cli/src/menu.ts                 ANSI color helpers used by logs and terminal output
apps/cli/src/ui.ts                   dependency checks
apps/cli/src/tmdb.ts                 TMDB season/episode data with proxy fallback
apps/cli/src/session-flow.ts         start-episode selection and provider/session flow helpers
apps/cli/src/history.ts              watch history persistence
apps/cli/src/config.ts               persisted user config + provider overrides
apps/cli/src/services/providers/*    active direct-provider adapters and registry
apps/cli/src/legacy/browser/*        quarantined Playwright interception path; not active beta runtime
apps/cli/src/legacy/providers/*      quarantined browser/legacy providers; not active beta runtime
apps/experiments/*                   private provider research lab, not production runtime
apps/experiments/scratchpads/*       raw provider probes, captures, and reverse-engineering scratch work
```

## Commands

```sh
bun run dev
bun run dev -- -S "Dune"
bun run dev -- -i 438631 -t movie
bun run dev -- -a
bun run dev -- --debug
bun run link:global
```

Before finishing work:

```sh
bun run typecheck
bun run lint
bun run fmt
```

Use `bun run test` if tests are relevant and available. Do not use `bun test` directly.
Unit tests live under `apps/cli/test/unit/`, integration tests under `apps/cli/test/integration/`, and live provider checks under `apps/cli/test/live/`.

## Hard Boundaries

- `apps/cli/index.ts` is a temporary compatibility wrapper only; new runtime work belongs in `apps/cli/src/main.ts`
- Episode numbers are 1-based in the UI; providers adapt internally
- `apps/cli/src/services/providers/definitions/index.ts` is the single registry source of truth
- `isAnimeProvider: true` is what places a provider in anime mode
- `packages/providers/src/allmanga/api-client.ts` contains ani-cli parity logic; check external parity before changing crypto or decoder constants
- On this machine, the local canonical ani-cli checkout for AllAnime or AllManga parity checks is `~/Projects/osc/ani-cli`
- If AllAnime or AllManga issues arise, compare against that local ani-cli checkout first, treat it as the reference behavior until upstream is clearly unmaintained, and document any temporary local divergence in provider docs or plans
- Browser/Playwright provider behavior belongs in `apps/cli/src/legacy/browser/*` until a future optional `@kunai/runtime-browser` package exists

## User Data

- Config: `~/.config/kunai/config.json`
- Provider overrides: `~/.config/kunai/providers.json`
- Data DB: OS app data dir `kunai-data.sqlite`
- Cache DB: OS cache dir `kunai-cache.sqlite`
- JSON config/provider stores remain; JSON history/cache stores are legacy implementation details only
- Logs: `./logs.txt`

## Active Planning Docs

- [.plans/roadmap.md](.plans/roadmap.md): current status and what is next
- [.plans/kunai-beta-v1-scope-and-contracts.md](.plans/kunai-beta-v1-scope-and-contracts.md): locked beta v1 scope, architecture seams, telemetry posture
- [.plans/kunai-execution-passes-and-cli-modes.md](.plans/kunai-execution-passes-and-cli-modes.md): execution passes, CLI modes, autoskip notes
- [.plans/kunai-principal-grill-qa.md](.plans/kunai-principal-grill-qa.md): current product and architecture decision pressure-test
- [.plans/kunai-architecture-and-cache-hardening.md](.plans/kunai-architecture-and-cache-hardening.md): web, daemon, cache, relay, and paid compute architecture
- [.plans/kunai-experience-and-growth-moat.md](.plans/kunai-experience-and-growth-moat.md): CLI-first product moat, web experience, premium model, and growth strategy
- [.plans/turborepo-and-package-boundaries.md](.plans/turborepo-and-package-boundaries.md): monorepo migration order, package ownership, legacy quarantine, Zod, SQLite, and tsgo decisions
- [.plans/persistent-shell-implementation.md](.plans/persistent-shell-implementation.md): migration order for the persistent shell and canonical runtime
- [.plans/ink-migration.md](.plans/ink-migration.md): terminal UI rewrite plan
- [.plans/search-service.md](.plans/search-service.md): deferred search/provider decoupling
- [.plans/yt-provider.md](.plans/yt-provider.md): deferred YouTube provider research
- [.plans/provider-hardening.md](.plans/provider-hardening.md): provider research, hardening, and scraper capability roadmap
- [.plans/repo-infrastructure.md](.plans/repo-infrastructure.md): completed CI, Husky, lint-staged, and template guardrail status
- [.plans/kitsune-design-system-and-recommendations.md](.plans/kitsune-design-system-and-recommendations.md): implemented design-token and `/discover` status plus remaining polish
- [.plans/presence-integrations.md](.plans/presence-integrations.md): Discord presence setup, diagnostics, and activity polish
- [.plans/catalog-release-schedule-service.md](.plans/catalog-release-schedule-service.md): anime/TV release dates, releasing-today, and shared schedule cache
- [.plans/download-offline-onboarding.md](.plans/download-offline-onboarding.md): planned download, offline library, and setup wizard slices
