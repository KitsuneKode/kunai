# Kunai Turborepo And Package Boundaries Plan

Status: Phase 4D provider resolve-result wiring in progress

Last updated: 2026-04-29

Use this plan for the physical migration from the current CLI into the Kunai monorepo. The active execution target is the full-fledged CLI; web, desktop, remote sync, and paid cloud work are parked until the CLI runtime is excellent.

## Goal

Move to a Turborepo without breaking the CLI.

The first migration is a packaging move, not a rewrite. We should preserve current behavior, isolate legacy code, and create package boundaries that let future agents extract shared logic safely.

Phase 1 result:

- root `package.json` is a private workspace orchestrator
- `turbo.json` delegates common checks to workspace packages
- the CLI app package is named `kunai-cli` under `apps/cli`
- provider scratchpads moved to `apps/experiments/scratchpads`
- no provider logic or runtime behavior was intentionally changed

## Brutal Constraints

- Do not big-bang rewrite providers during the workspace move.
- Do not import production code from `packages/legacy`.
- Do not move scratchpads directly into `@kunai/core` as if they are production-ready.
- Do not introduce web/desktop apps until the CLI still builds and runs from `apps/cli`.
- Do not change runtime behavior and folder topology in the same commit unless unavoidable.
- Do not use package extraction as an excuse to defer the true shell. After the physical move, shell state and command ownership become the next architectural priority.
- Do not use a heavy ORM for local SQLite unless repository classes become unmaintainable.

## Target Workspace

```text
apps/
  cli/
    Current production CLI after move.

  experiments/
    Private research lab package for scratchpads, provider probes, reverse-engineering notes, and demos.
    Not part of production builds.

  web/
    Deferred until CLI/package contracts stabilize.

  desktop/
    Deferred until daemon protocol stabilizes.

packages/
  types/
    Future package name: `@kunai/types`.
    Pure TypeScript contracts.

  schemas/
    Future package name: `@kunai/schemas`.
    Zod schemas for untrusted or serialized data.

  core/
    Future package name: `@kunai/core`.
    Provider contracts, capabilities, resolver orchestration, cache-key policy, source ranking, runtime ports, and tracing.

  storage/
    Future package name: `@kunai/storage`.
    OS path resolver, SQLite connections, migrations, typed repositories, TTL classes, pruning, history, stream cache, provider health, source inventory, and resolve traces.

  config/
    Future package name: `@kunai/config`.
    Config defaults, validation, migrations, and platform-aware paths.

  ui-cli/
    Future package name: `@kunai/ui-cli`.
    Ink primitives, tokens, badges, panels, shell components, and CLI design-system code.

  legacy/
    Reference-only legacy runtime/provider code during migration.
```

## Phase 0: Pre-Migration Hygiene

Do this before moving folders:

1. Resolve the dirty `apps/cli/index.ts` and `apps/cli/src/main.ts` state with the agent/user that owns it.
2. Confirm `apps/cli/src/main.ts` is the canonical runtime.
3. Decide whether `apps/cli/index.ts` remains runnable, becomes a shim, or moves to `packages/legacy`.
4. Run `bun run typecheck`, `bun run lint`, and relevant tests from the current root.
5. Commit only the cleanup needed for a clean migration baseline.

Acceptance:

- Working tree has no unrelated runtime edits.
- Current CLI command still works from the root.
- The legacy decision is documented in `.docs/architecture.md`.

## Phase 1: Minimal Workspace Move

Status: Complete.

Actions:

1. Create root workspace files: `package.json`, `turbo.json`, and workspace config.
2. Move current CLI package files into `apps/cli`.
3. Move scratchpads and experiments into `apps/experiments`.
4. Keep imports mostly relative inside `apps/cli` for this phase.
5. Add root scripts that delegate to the CLI package.

Root scripts should make common commands boring:

```sh
bun run dev
bun run typecheck
bun run lint
bun run fmt
bun run test
```

Acceptance:

- `bun install` works from repo root.
- `bun run dev` launches the CLI from `apps/cli`.
- `bun run typecheck` covers `apps/cli`.
- Package/build metadata still points at the CLI entrypoint.

## Phase 1.5: True Shell Foundation

Do this immediately after the CLI successfully runs from `apps/cli`.

Goal:

- make the CLI architecture feel like one mounted terminal app before we extract long-lived packages around it
- avoid freezing transitional helper-shell patterns into shared package APIs
- keep workflow orchestration app-owned while extracting reusable UI primitives later

Required shape:

- one `AppRoot` owns the fullscreen frame, header, status context, content region, footer, command bar, and overlay host
- browse, picker, loading, playback, diagnostics, history, settings, and post-playback are content states inside that root
- one app-state model owns navigation and back-stack semantics
- one command registry owns labels, enablement, disabled reasons, and handlers
- `Esc` closes, clears, or goes back; it never confirms or starts playback
- resize blockers replace scrollback-dependent overflow
- source confidence and resolve trace have a visible home in the shell model, even if the first implementation is minimal

Non-goals:

- do not extract `packages/ui-cli` before the root shell stabilizes
- do not redesign every visual component in the same pass
- do not move provider internals while shell ownership is changing
- do not make the shell depend on web/desktop concepts

Acceptance:

- `bun run dev` from the repo root still launches the CLI.
- root shell remains mounted across browse, picker, loading, playback, and post-playback.
- key global actions are routed through one command registry.
- at least one overlay flow proves the shared overlay host.
- tests cover command availability, one back-stack path, and one resize/collapse policy.

## Phase 1.8: Single Mounted Content Tree

Status: Planned in [.plans/phase-1.8-single-mounted-content-tree.md](./phase-1.8-single-mounted-content-tree.md).

Do this after Phase 1.5 and before shared package extraction.

Goal:

- finish the CLI shell migration by making browse, loading, playback, and post-playback render as content states inside one mounted root shell
- reduce `apps/cli/src/app-shell/ink-shell.tsx` and split shell responsibilities before package APIs harden around transitional UI flows
- keep provider resolution, playback policy, history, diagnostics, subtitles, and config behavior stable

Acceptance:

- helper-shell adapters are no longer the normal browse/playback path
- `SearchPhase` and `PlaybackPhase` stop launching UI shells and become orchestration/controllers
- root overlays and root pickers keep working without remount assumptions
- back, `Esc`, command routing, autoplay, history, and provider switching remain deterministic
- remaining fallback helpers are documented if any survive

## Provider Package Decision

Grill verdict: yes, providers need a separate package boundary, but not as a raw `scraper-core` dumping ground.

Use `@kunai/core` as the long-term package name because the winning abstraction is resolution intelligence, not scraping. It will eventually own provider contracts, provider capability manifests, source ranking, cache-key policy, runtime ports, and `ResolveTrace` construction. It must not own UI, `mpv`, account billing, daemon transport, app-specific storage, or user-facing workflow state.

Do not move provider implementations in Phase 2. First define the data contracts and adapter seam that current `apps/cli` providers can satisfy. Then extract one low-risk provider path after cache policy exists.

Hard rules for the provider boundary:

- providers return data and evidence, not UI decisions
- providers never write history, config, stream cache, or health stores directly
- providers emit cache policy; `@kunai/storage` decides where and how it is stored
- providers declare required runtime capabilities instead of importing Playwright, `yt-dlp`, daemon, or web APIs directly
- providers return structured failure codes and a `ResolveTrace`, not only `null`
- providers expose browser-safety and relay-safety explicitly
- app surfaces choose UX, playback handoff, entitlement messaging, and recovery behavior
- web may import only browser-safe pure provider logic, never local-compute providers by accident

Target data flow:

```text
apps/cli controller
  -> @kunai/core resolver
  -> provider runtime ports
  -> StreamCandidate[] + SubtitleCandidate[] + ResolveTrace + CachePolicy
  -> @kunai/storage persistence/cache policy
  -> app-specific playback / UI / diagnostics
```

## Phase 2: Contracts Before Implementations

Status: Complete.

Do this only after Phase 1.8 has defined the shell boundaries well enough that shared packages do not accidentally depend on transitional UI flows.

Create `packages/types` and `packages/schemas` before extracting providers.

Phase 2 has two bounded slices:

- Phase 2A: create `@kunai/types` and `@kunai/schemas`, exports, package tests, and a harmless CLI type import. Complete in `04fa266`.
- Phase 2B: emit one typed `ResolveTrace` stub from an existing CLI runtime path without changing provider behavior. Complete in the follow-up Phase 2 completion commit.

Minimum contracts:

- `ProviderId`
- `ProviderCapability`
- `ProviderRuntime`
- `TitleIdentity`
- `EpisodeIdentity`
- `StreamCandidate`
- `SubtitleCandidate`
- `ResolveTrace`
- `ResolveErrorCode`
- `CachePolicy`
- `CacheTtlClass`
- `ProviderHealth`
- `PlaybackRecoveryEvent`
- `ProviderResolveInput`
- `ProviderResolveResult`
- `ProviderRuntimePort`
- `ProviderOperation`
- `ProviderFailure`

Validation boundary:

- TypeScript contracts live in `packages/types`.
- Zod schemas live in `packages/schemas`.
- Zod is used for serialized/untrusted data, not every internal function call.

Provider contract requirements:

- `ProviderResolveInput` must include normalized title identity, optional episode identity, requested media kind, preferred language/subtitle hints, user intent strength, and allowed runtime capabilities.
- `ProviderResolveResult` must include stream candidates, subtitle candidates, cache policy, trace, structured errors, and optional health deltas.
- `StreamCandidate` should include URL or deferred locator, quality evidence, container/protocol, headers policy, expiration hints, provider ID, and confidence score.
- `SubtitleCandidate` should include language, label, source, format, confidence, sync evidence, and cache policy.
- `ResolveTrace` should include timings, cache layer used, provider runtime used, fallback attempts, selected candidate, and failure causes.
- `ProviderRuntimePort` should model runtime needs such as `fetch`, browser lease, iframe interception, `yt-dlp`, local credentials, and relay-safe fetch without tying contracts to the CLI implementation.

Acceptance:

- CLI compiles while importing shared contracts.
- No provider behavior changes yet.
- One small runtime path emits a typed `ResolveTrace` stub.
- Root `lint`, `typecheck`, and `test` include `@kunai/types` and `@kunai/schemas`.
- No `@kunai/core`, provider implementation extraction, or cache storage migration happens in Phase 2.

Drift guard:

- If a change moves provider implementations, creates provider adapters, changes cache paths, or changes stream resolution behavior, it belongs to Phase 3/4, not Phase 2.
- If a shared type needs runtime validation, add it to `@kunai/schemas` only when it crosses storage, IPC, relay, provider-response, imported-data, sync, or plugin-manifest boundaries.

## Phase 3: CLI Storage Package

Extract storage foundations before provider extraction so the CLI has reliable local history, cache, diagnostics, and source intelligence.

Status: Complete.

Current execution mode:

- Build for the CLI first.
- Use SQLite from the start for local history and cache.
- Do not preserve repo-local `stream_cache.json` compatibility.
- Do not build remote sync, web, desktop, paid cloud, or account flows in this phase.

Actions:

1. Create `packages/storage` with package name `@kunai/storage`.
2. Add OS-aware data/cache path resolution.
3. Add SQLite connection helpers for `kunai-data.sqlite` and `kunai-cache.sqlite`.
4. Add migration runner and initial migrations.
5. Add typed repository interfaces for history, stream cache, provider health, source inventory, and resolve traces.
6. Add TTL and cache-key helpers using `@kunai/types`.
7. Add tests for paths, migrations, TTLs, cache keys, and repository basics.

SQLite decision:

- Use `bun:sqlite` plus small typed repository classes.
- Use migrations stored in code or SQL files.
- Use WAL mode for local stores.
- Avoid Prisma for CLI/Desktop packaging.
- Consider Drizzle later only if query complexity grows enough to justify it.

Acceptance:

- `@kunai/storage` compiles and tests pass.
- `kunai-data.sqlite` and `kunai-cache.sqlite` paths are deterministic on Linux, macOS, and Windows.
- Migrations are idempotent.
- Repositories do not expose raw SQL to CLI callers.
- Cache write failure can be handled as non-fatal by the CLI wiring phase.
- No provider behavior changes yet.

Phase 3B wiring, after the package foundation:

1. Replace CLI JSON history with SQLite history.
2. Replace CLI JSON stream cache with SQLite stream cache.
3. Add provider health and resolve trace persistence.
4. Update cache/history/settings UI copy so users see the real local storage model.

## Phase 4: First Provider Extraction

Extract one simple provider path first. Prefer a 0-RAM or low-risk provider before Playwright-heavy providers.

Status: Phase 4D.6 playback refresh and fallback controls in progress.

Phase 4A foundation:

- create `@kunai/core`
- move VidKing provider manifest, capability declaration, runtime-port declaration, and cache policy into `@kunai/core`
- add a CLI compatibility adapter for converting current `StreamInfo`-shaped results into `ProviderResolveResult`
- wire the CLI VidKing definition through the core manifest without moving the working provider implementation yet
- keep the current Playwright/browser scrape path honest in the manifest until a real 0-RAM implementation is production-wired

Phase 4B trace wiring:

- keep the existing CLI provider return shape stable
- attach `ProviderResolveResult` to resolved VidKing `StreamInfo`
- record the real provider trace in diagnostics when available
- prove the adapter with mocked provider tests before touching fallback orchestration

Phase 4C manifest coverage:

- add core manifests for VidKing, Cineby, BitCine, Braflix, AllAnime, and Cineby Anime
- make CLI provider metadata and capability declarations derive from the core manifests
- keep all provider implementations inside `apps/cli` for now
- explicitly mark every current provider as not browser-safe until a production browser-safe path exists
- declare runtime ports honestly, including hybrid fetch plus Playwright fallback providers

Phase 4D provider resolve-result wiring:

- attach `ProviderResolveResult` to VidKing, Cineby, BitCine, Braflix, AllAnime, and Cineby Anime
- keep the existing `StreamInfo | null` provider interface until fallback, history, and autoplay are proven against the richer result shape
- preserve honest runtime attribution: Playwright providers use `playwright-lease`; Braflix direct media uses `node-fetch`; AllAnime is marked `node-fetch` until the hidden embed-scraper branch is split into an explicit runtime port
- keep diagnostics reading attached resolve traces from streams instead of forcing app code to know provider internals

Phase 4D.5 playback control gate:

- add a `PlayerControlService` that owns the currently active player control handle
- expose an active `mpv` stop command through the IPC session when available, with process termination as a fallback before IPC is ready
- let the mounted playback shell stop active playback with `q` without forcing the user to kill the whole Kunai process
- keep `Esc` reserved for close/back/control-panel semantics instead of making it a destructive playback stop
- treat reload, same-provider refresh, fallback hot-swap, and subtitle reload as the next control-port increments after stop is proven

Phase 4D.6 playback refresh and fallback controls:

- extend the active playback control service with explicit `refresh`, `fallback`, and `reload-subtitles` intents
- keep refresh/fallback owned by `PlaybackPhase`: stop the current player, save progress, then re-enter normal source resolution at the last known timestamp
- keep subtitle reload as a direct `mpv` IPC command because it does not require source re-resolution
- do not call this full hot-swap yet; true seamless `loadfile replace` and provider auto-heal comes after resolver orchestration can safely return ranked candidates

Provider move order:

1. Manifest-only for each provider: id, domain, media kinds, capabilities, runtime ports, cache policy, browser/relay safety. Phase 4C.
2. Adapter wiring for each provider: attach `ProviderResolveResult` while preserving current `StreamInfo` callers. Phase 4D.
3. Playback control gate: prove active `mpv` stop/control from the TUI before moving more orchestration. Phase 4D.5.
4. Playback refresh/fallback controls: route user control intents through playback policy without bypassing history or diagnostics. Phase 4D.6.
5. Resolver orchestration: introduce a core resolver that ranks providers, calls runtime ports, and returns `ProviderResolveResult`. Phase 4E.
6. Implementation extraction: move only pure/provider-local logic into `@kunai/core`; keep Playwright, `mpv`, config, history, and storage wiring in `apps/cli`. Phase 4F.
7. Runtime-port split: replace direct browser imports with injected ports so CLI, future daemon, and future web can safely choose allowed runtimes. Phase 4G.
8. Remove legacy provider shape only after every production provider emits core results and fallback/autoplay/history are green. Phase 4H.

Do not move all providers at once. The first full implementation extraction should be a low-risk provider path after every provider has a manifest and at least VidKing has proven trace wiring in production flow.

Actions:

1. Create `packages/core` with package name `@kunai/core`.
2. Move capability declaration and cache policy for one provider.
3. Add a compatibility adapter around the current `apps/cli` provider shape before moving implementation internals.
4. Keep app-specific UI, history, config, daemon transport, and `mpv` behavior in `apps/cli`.
5. Return `ProviderResolveResult`, not raw URLs only.
6. Add tests around capability declaration, cache key, runtime-port selection, and trace shape.

Acceptance:

- CLI imports one provider path or provider adapter through `@kunai/core`.
- Existing provider fallback still works.
- Trace output explains cache/provider/runtime path.
- No provider writes app storage directly.

## Phase 5: CLI UI Package

Extract reusable terminal components only after the root shell stabilizes.

Actions:

1. Create `packages/ui-cli`.
2. Add tokens and primitive components first.
3. Move badges, panels, command bar, and source-confidence widgets after they are stable.
4. Keep workflow orchestration inside `apps/cli`.

Design rule:

The CLI should be shadcn-inspired, not shadcn-copied. It needs composable, tokenized, terminal-native components.

Acceptance:

- CLI visual primitives come from `@kunai/ui-cli`.
- No runtime workflow logic is hidden inside UI components.
- High-frequency keyboard interactions remain instant.

## Phase 6: Web Readiness Gate

Do not start serious web implementation until:

- provider capability schema exists
- cache policy exists
- browser-safe providers are marked explicitly
- relay-safe provider operations are listed
- local daemon pairing contract is drafted
- `ResolveTrace` can be rendered in CLI

The first web app should be static-first:

- static shell
- IndexedDB cache
- browser-safe provider modules only
- provider RPC relay for allowlisted operations
- local pairing as an unlock, not first-run requirement

## Tooling Decisions

TypeScript:

- Keep `tsc --noEmit` as canonical until native TypeScript tooling proves parity.
- Add `tsgo` only as optional `typecheck:fast` after comparing output against `tsc`.

Validation:

- Use Zod at boundaries.
- Use TypeScript internally.
- Never let validation become a hot-path tax.

Formatting and linting:

- Keep root scripts delegating to workspaces.
- Do not introduce a new formatter during the monorepo migration unless that is the explicit task.

## Commit Strategy

Recommended commits:

1. `docs: add turborepo execution plan`
2. `chore: add turbo workspace scaffold`
3. `refactor: move cli into apps cli`
4. `chore: move experiments into apps experiments`
5. `refactor: establish true root shell`
6. `refactor: unify cli mounted content tree`
7. `feat: add shared contracts package`
8. `feat: move cache paths into shared package`
9. `feat: extract first provider into kunai core`

Keep each commit reviewable. This migration will be hard enough without mystery meat diffs.
