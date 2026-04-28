# Kunai Turborepo And Package Boundaries Plan

Status: Planned

Last updated: 2026-04-28

Use this plan for the first physical migration from the current single-package CLI into the Kunai monorepo. This is the execution bridge between the current runtime and the larger CLI, web, desktop, daemon, and premium ecosystem.

## Goal

Move to a Turborepo without breaking the CLI.

The first migration is a packaging move, not a rewrite. We should preserve current behavior, isolate legacy code, and create package boundaries that let future agents extract shared logic safely.

## Brutal Constraints

- Do not big-bang rewrite providers during the workspace move.
- Do not import production code from `packages/legacy`.
- Do not move scratchpads directly into `scraper-core` as if they are production-ready.
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
    Scratchpads, provider probes, reverse-engineering notes, and demos.
    Not part of production builds.

  web/
    Deferred until CLI/package contracts stabilize.

  desktop/
    Deferred until daemon protocol stabilizes.

packages/
  types/
    Pure TypeScript contracts.

  schemas/
    Zod schemas for untrusted or serialized data.

  scraper-core/
    Provider contracts, capabilities, resolver orchestration, cache-key policy, source ranking, and tracing.

  cache/
    OS path resolver, cache repositories, SQLite stores, JSON compatibility migration, TTL classes.

  config/
    Config defaults, validation, migrations, and platform-aware paths.

  ui-cli/
    Ink primitives, tokens, badges, panels, shell components, and CLI design-system code.

  legacy/
    Reference-only legacy runtime/provider code during migration.
```

## Phase 0: Pre-Migration Hygiene

Do this before moving folders:

1. Resolve the dirty `index.ts` and `src/main.ts` state with the agent/user that owns it.
2. Confirm `src/main.ts` is the canonical runtime.
3. Decide whether `index.ts` remains runnable, becomes a shim, or moves to `packages/legacy`.
4. Run `bun run typecheck`, `bun run lint`, and relevant tests from the current root.
5. Commit only the cleanup needed for a clean migration baseline.

Acceptance:

- Working tree has no unrelated runtime edits.
- Current CLI command still works from the root.
- The legacy decision is documented in `.docs/architecture.md`.

## Phase 1: Minimal Workspace Move

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

## Phase 2: Contracts Before Implementations

Do this only after Phase 1.5 has defined the shell boundaries well enough that shared packages do not accidentally depend on transitional UI flows.

Create `packages/types` and `packages/schemas` before extracting providers.

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

Validation boundary:

- TypeScript contracts live in `packages/types`.
- Zod schemas live in `packages/schemas`.
- Zod is used for serialized/untrusted data, not every internal function call.

Acceptance:

- CLI compiles while importing shared contracts.
- No provider behavior changes yet.
- One small runtime path emits a typed `ResolveTrace` stub.

## Phase 3: Cache And Storage Package

Extract storage foundations before provider extraction so all surfaces share the same policy.

Actions:

1. Create `packages/cache`.
2. Move OS path resolution into it.
3. Add JSON compatibility stores for current config/history/cache behavior.
4. Move stream cache default path to OS cache directory.
5. Add schema version and TTL class to stream cache entries.
6. Keep repo-local `stream_cache.json` as legacy read fallback only.

SQLite decision:

- Use `bun:sqlite` plus small typed repository classes.
- Use migrations stored in code or SQL files.
- Use WAL mode for daemon-era stores.
- Avoid Prisma for CLI/Desktop packaging.
- Consider Drizzle later only if query complexity grows enough to justify it.

Acceptance:

- CLI no longer writes new default stream cache entries to repo root.
- Old `stream_cache.json` can be migrated or read once.
- Cache write failure does not crash playback.

## Phase 4: First Provider Extraction

Extract one simple provider path first. Prefer a 0-RAM or low-risk provider before Playwright-heavy providers.

Actions:

1. Add provider interface to `packages/scraper-core`.
2. Move capability declaration and cache policy for one provider.
3. Keep app-specific UI and `mpv` behavior in `apps/cli`.
4. Return `StreamCandidate[]` plus `ResolveTrace`, not raw URLs only.
5. Add tests around cache key and trace shape.

Acceptance:

- CLI imports one provider through `@kunai/scraper-core`.
- Existing provider fallback still works.
- Trace output explains cache/provider/runtime path.

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
6. `feat: add shared contracts package`
7. `feat: move cache paths into shared package`
8. `feat: extract first provider into scraper core`

Keep each commit reviewable. This migration will be hard enough without mystery meat diffs.
