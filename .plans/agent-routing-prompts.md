# Kunai Multi-Agent Routing Prompts

Status: Active Reference

Last updated: 2026-04-29

Use this file to route work across multiple agents without reloading the whole Kunai vision into every session.

The rule is simple:

- Day-1 agents own behavior-preserving runtime and shell work.
- Fresh agents own bounded tests, docs, fixtures, audits, and narrow implementation slices.
- Principal architecture work owns contracts, storage/cache design, provider-core extraction, and integration review.

Do not run two agents with overlapping write ownership at the same time.

## Global Routing Rules

Use these rules in every prompt unless a task explicitly says otherwise:

- Start with `git status --short`.
- Do not revert unrelated changes.
- Keep commits small and reviewable.
- Do not rewrite providers during shell or workspace migration.
- Do not start web/desktop until CLI, storage, and provider/package contracts are stable.
- Do not add Prisma or a heavy ORM.
- Use TypeScript for internal contracts.
- Use Zod only at trust, storage, IPC, relay, provider-response, sync, imported-dataset, or plugin-manifest boundaries.
- Prefer tests around pure policy/state logic over brittle terminal snapshots.
- If a task touches `apps/cli/src/app-shell/**`, `apps/cli/src/app/**`, `apps/cli/src/main.ts`, or provider resolution, it needs a Day-1/runtime-aware agent or principal review.

## Prompt 0: Phase 1 Migration Finisher

Use this only if the Turborepo move is in progress and not yet cleanly committed.

```md
You are in the Kunai repo after the Turborepo migration has started.

Goal:
Finish Phase 1 only: make the minimal Turborepo move clean, verified, and committed.

Read only:
1. `AGENTS.md`
2. `.plans/turborepo-and-package-boundaries.md`
3. `.docs/architecture.md`
4. `.docs/architecture-v2.md`

Hard boundaries:
- Do not start true shell refactor.
- Do not extract `packages/types`, `packages/storage`, or `@kunai/core`.
- Do not rewrite providers.
- Do not start web/desktop.
- Do not make visual redesign changes.

Tasks:
1. Inspect `git status --short`.
2. Verify root package/workspace setup.
3. Verify current CLI lives under `apps/cli`.
4. Verify scratchpads/probes live under `apps/experiments`.
5. Fix broken paths/imports/scripts caused by the move.
6. Make root scripts work:
   - `bun run dev`
   - `bun run typecheck`
   - `bun run lint`
   - `bun run test`
   - `bun run build`
7. Update only docs that reference changed paths or commands.
8. Run verification.
9. Commit the Phase 1 migration only.

Acceptance:
- Root `bun run dev` launches the CLI.
- Root `bun run build` produces the CLI artifact.
- No provider behavior changes were introduced.
- Working tree is clean after commit.

Report:
- commit hash
- verification results
- remaining risks
- exact next prompt to use: `Prompt 1: Day-1 True Root Shell`
```

## Prompt 1: Day-1 True Root Shell

Use this for agents who already know the runtime history and shell weirdness.

```md
You are working in Kunai after the Phase 1 Turborepo migration is committed.

Goal:
Execute Phase 1.5: true root shell foundation in `apps/cli`.

Read:
1. `AGENTS.md`
2. `.plans/persistent-shell-implementation.md`
3. `.plans/fullscreen-root-shell-redesign.md`
4. `.plans/cli-ux-overhaul.md`
5. `.docs/ux-architecture.md`
6. `.docs/design-system.md`
7. `.docs/testing-strategy.md`

Context assumption:
You may already remember Kunai's product direction. Do not reread brainstorms unless blocked.

Hard boundaries:
- Do not extract shared packages yet.
- Do not rewrite providers.
- Do not start web/desktop.
- Do not redesign every component visually.
- Keep workflow orchestration in `apps/cli`.
- Do not create `packages/ui-cli` yet.

Tasks:
1. Inspect current root shell/app-shell structure.
2. Identify remaining helper-shell/remount boundaries.
3. Make or refine one root owner for:
   - fullscreen frame
   - header/status context
   - content region
   - footer
   - command bar
   - overlay host
4. Model browse, picker, loading, playback, diagnostics, history, settings, and post-playback as content states where safe.
5. Centralize command labels, enablement, disabled reasons, and handlers through one registry/router.
6. Ensure `Esc` closes, clears, or goes back; it must never implicitly confirm playback.
7. Add or update tests for:
   - command availability
   - one back-stack/Esc path
   - one resize/collapse policy
8. Run relevant checks and commit.

Acceptance:
- CLI still launches from root.
- Main browse/playback path uses one mounted shell as much as safely possible.
- At least one overlay flow proves shared overlay ownership.
- Remaining transitional shell gaps are documented.

Report:
- shell ownership changed
- flows still transitional
- tests added/updated
- verification results
```

## Prompt 2: Principal Contracts Package

Use this for principal architecture work after Phase 1.8 is committed. This is a good task to give to Codex when you want the long-term shape protected.

```md
You are working in Kunai after Phase 1, Phase 1.5, and Phase 1.8 are committed.

Goal:
Complete Phase 2 by creating or hardening `packages/types` and `packages/schemas` with package names `@kunai/types` and `@kunai/schemas`, without changing provider behavior.

Read:
1. `AGENTS.md`
2. `.docs/architecture-v2.md`
3. `.plans/turborepo-and-package-boundaries.md`
4. `.plans/kunai-architecture-and-cache-hardening.md`
5. `.plans/storage-hardening.md`

Hard boundaries:
- Do not extract provider implementations.
- Do not move cache/history storage yet.
- Do not add web/desktop.
- Do not add heavy ORM tooling.
- Do not create `packages/core` in this phase.
- Do not change stream resolution, cache path, provider fallback, history, or playback behavior.

Tasks:
1. Create `packages/types`.
2. Create `packages/schemas`.
3. Define minimal shared contracts:
   - `ProviderId`
   - `ProviderRuntime`
   - `ProviderCapability`
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
4. Add Zod schemas only for serialized/untrusted forms.
5. Wire package exports.
6. Import one harmless type into `apps/cli` to prove workspace resolution.
7. Emit one typed `ResolveTrace` stub from one small CLI runtime path, preferably diagnostics-only.
8. Add tests for schema/type boundary behavior and trace-stub construction.
9. Run verification and commit.

Acceptance:
- CLI behavior unchanged.
- Shared contracts compile.
- Zod is not used as hot-path internal validation.
- Workspace imports work from `apps/cli`.
- One runtime path records or emits a typed `ResolveTrace` stub.
- Root `lint`, `typecheck`, and `test` include the shared packages.
```

## Prompt 1.8: Day-1 Single Mounted Content Tree

Use this for the Day-1/runtime-aware agent after root overlays and pickers are already migrated.

```md
You are working in Kunai after Phase 1.5 root shell foundation is committed.

Goal:
Execute Phase 1.8: make browse, loading, playback, and post-playback one mounted content tree in `apps/cli`.

Read:
1. `AGENTS.md`
2. `.plans/phase-1.8-single-mounted-content-tree.md`
3. `.plans/persistent-shell-implementation.md`
4. `.plans/fullscreen-root-shell-redesign.md`
5. `.docs/ux-architecture.md`
6. `.docs/testing-strategy.md`

Context assumption:
You already know the broad product direction. Do not reread brainstorms or monetization docs unless blocked.

Hard boundaries:
- Do not extract shared packages.
- Do not rewrite providers.
- Do not start web/desktop.
- Do not change playback policy, history persistence, subtitle resolution, or provider fallback semantics unless required by a failing test.
- Do not redesign colors/theme in this phase; keep visual changes structural and minimal.

Tasks:
1. Add a pure root content-state union and adapter for home, browse, loading, playback, post-playback, and fallback states.
2. Extract root overlay/picker rendering out of `ink-shell.tsx` where safe.
3. Convert browse to root content without losing query, result list, selected index, details-first enter flow, or command palette behavior.
4. Convert playback and post-playback to root content without changing provider resolution, autoplay, history save, subtitle state, or navigation semantics.
5. Retire helper-shell launches as the normal path; document any remaining fallbacks.
6. Add tests for:
   - root content selection
   - overlay priority over content
   - browse state surviving content swaps
   - playback -> post-playback -> search
   - autoplay staying root-owned
   - one resize/collapse transition across content states
7. Run `bun run typecheck`, `bun run lint`, and `bun run test`.
8. Commit in small phase-labeled commits.

Acceptance:
- The CLI feels like one mounted app whose content changes in place.
- `SearchPhase` and `PlaybackPhase` behave as controllers/orchestrators, not UI shell launchers.
- `apps/cli/src/app-shell/ink-shell.tsx` is materially smaller or clearly split by responsibility.
- Existing root-owned overlays and pickers still work.
- Remaining transitional paths are documented.
```

## Prompt 2A: Fresh Agent Contract Tests

Use this for a fresh agent after Prompt 2.

```md
You are working in Kunai. Your task is bounded test coverage only.

Read:
1. `AGENTS.md`
2. `.docs/testing-strategy.md`
3. `packages/types`
4. `packages/schemas`

Goal:
Add focused tests for the shared contracts and schemas.

Hard boundaries:
- Do not change production behavior unless a test reveals a clear typo.
- Do not edit app-shell/provider/runtime files.
- Do not add broad integration tests.

Tasks:
1. Add fixtures for valid and invalid serialized payloads.
2. Test Zod schemas for cache policy, provider capability, resolve trace, and stream candidate shapes.
3. Test that schema outputs align with exported TypeScript types where practical.
4. Run the relevant package tests.
5. Commit only tests/fixtures and tiny schema typo fixes if needed.

Report:
- tests added
- invalid cases covered
- any schema ambiguity found
```

## Prompt 3: Principal Storage Package

Use this for principal architecture work after Phase 2 is committed.

```md
You are working in Kunai after Phase 2 shared contracts are committed.

Goal:
Complete Phase 3A by creating `packages/storage` with package name `@kunai/storage`, without changing CLI runtime behavior yet.

Read:
1. `AGENTS.md`
2. `.docs/architecture.md`
3. `.docs/architecture-v2.md`
4. `.plans/turborepo-and-package-boundaries.md`
5. `.plans/storage-hardening.md`
6. `.docs/testing-strategy.md`

Hard boundaries:
- Do not extract providers.
- Do not wire the CLI from JSON history/cache into SQLite yet.
- Do not build remote sync, accounts, web, desktop, or paid cloud.
- Do not add Prisma or a heavy ORM.
- Do not preserve repo-local `stream_cache.json` as a compatibility contract.
- Do not change playback, provider fallback, subtitle behavior, or cache runtime behavior in this phase.

Tasks:
1. Create `packages/storage` as `@kunai/storage`.
2. Add OS-aware path resolution for config, data DB, cache DB, logs, and temp files.
3. Add `bun:sqlite` connection helpers for `kunai-data.sqlite` and `kunai-cache.sqlite`.
4. Add an idempotent migration runner.
5. Add initial migrations for:
   - history latest-progress table
   - stream cache table
   - provider health table
   - source inventory table
   - resolve trace ring buffer table
6. Add repository interfaces and basic implementations.
7. Add TTL and cache-key helpers using `@kunai/types`.
8. Validate SQLite row boundaries with `@kunai/schemas` where data leaves or enters storage.
9. Add tests for path resolution, migrations, TTLs, cache keys, and basic repository round trips.
10. Run `bun run lint`, `bun run fmt`, `bun run typecheck`, and `bun run test`.
11. Commit Phase 3A only.

Acceptance:
- `@kunai/storage` compiles and is included in root checks.
- Tests prove migrations are idempotent.
- Linux, macOS, and Windows path behavior is deterministic.
- Repository APIs do not expose raw SQL to app callers.
- Cache writes can be treated as best-effort by later CLI wiring.
- No runtime behavior changed in `apps/cli`.

Report:
- commit hash
- package API summary
- tests added
- verification results
- next prompt to use: `Prompt 3B: Day-1 CLI Storage Wiring`
```

## Prompt 3B: Day-1 CLI Storage Wiring

Use this for a runtime-aware Day-1 agent after `@kunai/storage` exists and is committed.

```md
You are working in Kunai after `@kunai/storage` Phase 3A is committed.

Goal:
Wire the CLI to SQLite-backed history and stream cache while preserving user-facing playback behavior.

Read:
1. `AGENTS.md`
2. `.docs/architecture.md`
3. `.docs/diagnostics-guide.md`
4. `.plans/storage-hardening.md`
5. `.plans/turborepo-and-package-boundaries.md`
6. `.docs/testing-strategy.md`

Hard boundaries:
- Do not extract providers.
- Do not add web/desktop/remote sync.
- Do not add daemon pairing.
- Do not preserve old JSON history/cache as a compatibility contract unless explicitly instructed.
- Do not change provider fallback, subtitle selection, autoplay, or episode navigation semantics except to fix discovered storage bugs.

Tasks:
1. Replace JSON history reads/writes with `@kunai/storage` history repository.
2. Replace repo-local stream cache reads/writes with `@kunai/storage` stream cache repository.
3. Keep config and provider overrides JSON.
4. Make cache writes best-effort and non-fatal.
5. Update diagnostics/settings copy to show actual data/cache DB paths.
6. Remove default repo-root `stream_cache.json` assumptions from CLI runtime.
7. Add tests for:
   - playback progress save/load
   - completed episode semantics
   - stream cache hit/miss/expiry
   - cache write failure not crashing playback
8. Run `bun run lint`, `bun run fmt`, `bun run typecheck`, and `bun run test`.
9. Commit Phase 3B only.

Acceptance:
- Continue Watching works from SQLite.
- Stream cache works from OS cache DB.
- Repo root is not used for new default stream cache writes.
- CLI playback behavior is otherwise unchanged.
- Tests cover the previous history-not-showing risk.
```

## Prompt 4: Principal First Core Provider Extraction

Use this after contracts and the storage/cache policy exist.

```md
You are working in Kunai after contracts and `@kunai/storage` exist.

Goal:
Create the first core provider package, `packages/core` as `@kunai/core`, and extract one low-risk provider path or provider contract first.

Read:
1. `AGENTS.md`
2. `.docs/providers.md`
3. `.docs/provider-examples.md`
4. `.plans/provider-hardening.md`
5. `.plans/turborepo-and-package-boundaries.md`
6. `packages/types`
7. `packages/storage`

Hard boundaries:
- Extract one provider or one contract slice only.
- Do not move all providers.
- Do not change UI behavior.
- Do not touch web/desktop.

Tasks:
1. Create `packages/core` as `@kunai/core`.
2. Define provider interface and runtime-port contracts using shared types.
3. Add a compatibility adapter for the current `apps/cli` provider shape before moving internals.
4. Move capability declaration/cache policy for one low-risk provider.
5. Return `ProviderResolveResult` with `StreamCandidate[]`, `SubtitleCandidate[]`, `ResolveTrace`, cache policy, and structured failures where practical.
6. Keep `mpv`, UI, history/config storage, daemon transport, and app orchestration in `apps/cli`.
7. Add tests for provider capability, cache key policy, runtime-port selection, and trace shape.
8. Run verification and commit.

Acceptance:
- CLI still works.
- One provider path imports through `@kunai/core` or one core contract is proven.
- No broad provider rewrite.
```

## Prompt 5: Fresh Provider Dossier

Use this for fresh agents who can research one provider without touching production.

```md
You are working in Kunai. This is a read-mostly provider research task.

Read:
1. `AGENTS.md`
2. `.docs/provider-intake.md`
3. `.docs/provider-agent-workflow.md`
4. `.docs/provider-examples.md`
5. relevant provider files or experiment files only

Goal:
Produce or update one provider dossier with capability, runtime, cache, and failure notes.

Hard boundaries:
- Do not modify production provider code unless explicitly asked.
- Do not run broad rewrites.
- Do not touch shell/cache architecture.

Tasks:
1. Pick the assigned provider only.
2. Identify runtime type:
   - `browser-safe-fetch`
   - `node-fetch`
   - `playwright-lease`
   - `yt-dlp`
   - `debrid`
3. Identify cache policy, prefetch safety, credential needs, fallback confidence, and likely failure modes.
4. Write/update a concise dossier under provider docs or plans.
5. Include recommended tests or fixtures.

Report:
- what changed
- what is production-safe
- what needs principal review before implementation
```

## Prompt 6: Day-1 ResolveTrace UI

Use this after `ResolveTrace` exists.

```md
You are working in Kunai after `ResolveTrace` exists in shared contracts.

Goal:
Surface resolve trace and source confidence in the CLI shell without changing provider behavior.

Read:
1. `AGENTS.md`
2. `.plans/kunai-experience-and-growth-moat.md`
3. `.plans/kunai-architecture-and-cache-hardening.md`
4. `.docs/diagnostics-guide.md`
5. current `apps/cli/src/app-shell/**`

Hard boundaries:
- Do not redesign the entire shell.
- Do not rewrite providers.
- Do not change fallback policy.

Tasks:
1. Find the current diagnostics/status surfaces.
2. Add compact source confidence display.
3. Add trace summary display in diagnostics or companion panel.
4. Redact sensitive URLs/headers.
5. Add tests for trace formatting/redaction.
6. Run verification and commit.

Acceptance:
- Users can see cache/provider/runtime path.
- Failures have a clear next-action-oriented trace.
- No sensitive URLs or credentials are exported in shareable text.
```

## Prompt 7: Fresh Docs Sync

Use this after any phase that changes paths or commands.

```md
You are working in Kunai. This is a documentation sync task only.

Read:
1. `AGENTS.md`
2. `README.md`
3. `.docs/quickstart.md`
4. `.docs/architecture.md`
5. `.plans/roadmap.md`

Goal:
Update docs for changed paths, commands, package names, and current phase status.

Hard boundaries:
- Do not edit runtime code.
- Do not change plans beyond status/path/command corrections.
- Do not rewrite product strategy.

Tasks:
1. Search for stale paths or commands.
2. Update only docs affected by completed code changes.
3. Keep `roadmap.md` short.
4. Run markdown/link sanity checks if available.
5. Commit docs only.

Report:
- stale references fixed
- docs intentionally left unchanged
```

## Handoff Template

Every agent should end with:

```md
Summary:
- ...

Verification:
- `bun run typecheck`: pass/fail/not run
- `bun run lint`: pass/fail/not run
- `bun run test`: pass/fail/not run
- other:

Changed files:
- ...

Risks:
- ...

Next recommended prompt:
- Prompt N: ...
```

## Parallelism Rules

Safe in parallel:

- Fresh docs sync and provider dossier, if they write different files.
- Contract tests and provider dossier, if contracts are already stable.
- Docs audit and test fixture work.

Unsafe in parallel:

- Two agents editing `apps/cli/src/app-shell/**`.
- Shell migration and cache wiring.
- Provider extraction and provider runtime bugfixes.
- Package move and any app-shell rewrite.
- Any task that edits the same package exports.

If in doubt, serialize the work. Clean commits beat heroic merge conflict archaeology.
