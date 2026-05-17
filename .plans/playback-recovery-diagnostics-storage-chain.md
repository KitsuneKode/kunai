# Playback Recovery, Diagnostics, And Storage Safety Chain

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` when delegating independent tasks, or `superpowers:executing-plans` when running inline task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Implemented and verified on 2026-05-17

**Goal:** Lock playback recovery semantics, improve developer/debug diagnostics, and add conservative storage maintenance without risking user-owned data.

**Architecture:** Treat playback commands as separate intents: restart is local playback control, recover is repair/refetch of the same intent, refresh source is an advanced explicit provider/cache action, and fallback is source/provider switching. Diagnostics should follow one correlation chain from session to playback cycle to provider attempt to mpv/presence/cache events. Storage maintenance must only touch disposable cache-class tables automatically; history, lists, config, tokens, and completed download records stay durable unless the user explicitly removes them.

**Tech Stack:** Bun, TypeScript, Ink, `bun:sqlite`, `@kunai/storage`, existing diagnostics/correlation services, existing mpv persistent-session/player-control tests.

---

## Guardrails

- Do not auto-delete `history_progress`, `lists`, `list_items`, completed `download_jobs`, config JSON, provider overrides, or sync tokens.
- Do not invalidate the only currently playable stream until a replacement is verified, unless strong dead-stream evidence exists.
- Do not add live provider calls to default tests, CI, Husky, or normal startup maintenance.
- Do not expose raw stream URLs, auth tokens, cookies, referers, or headers in default diagnostics export.
- Keep the unrelated local `apps/cli/src/app-shell/ink-shell.tsx` resize hunk out of commits unless the user explicitly adopts it.

## Chained Execution Shape

The safest run order is:

1. **Task 1: Playback intent contract and command policy** — implemented through command copy, tests, and recovery/refresh separation.
2. **Task 2: Refresh/recover implementation and anti-abuse guardrails** — implemented with source-refresh cooldown and cached-stream preservation.
3. **Task 3: Correlated diagnostics event shape** — implemented for refresh/recover/cache decisions.
4. **Task 4: Diagnostics summary-first panel** — implemented in diagnostics panel projection.
5. **Task 5: Storage maintenance safety layer** — implemented in `@kunai/storage` and CLI startup maintenance service.
6. **Task 6: Continuation/new-episode projection follow-up** — implemented as a pure projection service and continue diagnostics hook.
7. **Task 7: Docs, release gate, and final verification** — docs updated; final verification results belong in the commit/report.

Parallel lanes:

- Lane A: Tasks 1-3 playback/diagnostics contract.
- Lane B: Task 5 storage maintenance.
- Lane C: docs/test checklist updates for Task 7 can begin after Task 1 decisions are written.
- Task 4 should wait until Task 3 names and data shapes stabilize.
- Task 6 should wait until Task 5 confirms durable-vs-cache ownership.

---

## Task 1: Playback Intent Contract

**Files:**

- Modify: `apps/cli/src/infra/player/PlayerControlService.ts`
- Modify: `apps/cli/src/infra/player/PlayerControlServiceImpl.ts`
- Modify: `apps/cli/src/app-shell/command-registry.ts`
- Modify: `apps/cli/src/app-shell/ink-shell.tsx`
- Test: `apps/cli/test/unit/infra/player/player-control-service-ordering.test.ts`
- Docs: `.docs/ux-architecture.md`

- [x] Add or confirm separate command paths for:
  - `restart/replay`: seek to beginning in current session when possible; no provider refetch by default.
  - `recover`: repair broken playback by refetching same intent and resuming near last trusted position.
  - `refresh source`: advanced/diagnostics-only explicit refetch.
  - `fallback`: switch source/provider after repair fails or user explicitly requests it.
- [x] Confirm existing replay/restart remains post-playback local start-over and does not expose refresh as a primary command.
- [x] Confirm existing recover remains a separate stop-backed repair intent and does not become replay.
- [x] Update command labels so normal playback surfaces do not show `Refresh Source` as a primary command.
- [x] Update `.docs/ux-architecture.md` with the locked vocabulary.
- [x] Include in the scoped implementation commit.

## Task 2: Refresh/Recover Guardrails

**Files:**

- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Modify: `apps/cli/src/services/playback/PlaybackResolveCoordinator.ts`
- Modify: `apps/cli/src/services/cache/stream-resolve-cache.ts`
- Modify: `apps/cli/src/services/playback/PlaybackResolveService.ts`
- Test: `apps/cli/test/unit/app/playback-recovery-policy.test.ts`
- Test: `apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts`

- [x] Add a small source-refresh cooldown policy scoped by title, episode, provider, and selected source/quality when known.
- [x] Make cooldown apply only to explicit healthy-playback `Refresh Source`, not to broken-stream `Recover`.
- [x] Preserve current playback if refresh fails and the current stream is still usable.
- [x] Show short feedback in shell state:
  - `No fresher source found. Continuing current stream.`
  - `Source was refreshed recently. Continuing current stream.`
  - `Could not repair this source. Trying fallback...`
- [x] Invalidate a stream cache entry before refetch only when evidence says it is suspect/dead.
- [x] If a replacement stream is found, switch to it and keep correlation IDs attached.
- [x] If no fresh replacement is found but cached stream is usable, continue with cached stream.
- [x] Add tests for refresh cooldown, recover bypassing cooldown, and cached fallback after fresh lookup failure.
- [x] Include in the scoped implementation commit.

## Task 3: Correlated Diagnostics Event Shape

**Files:**

- Modify: `apps/cli/src/services/diagnostics/diagnostic-event.ts`
- Modify: `apps/cli/src/services/diagnostics/correlation.ts`
- Modify: `apps/cli/src/services/diagnostics/DiagnosticsStoreImpl.ts`
- Modify: `apps/cli/src/services/diagnostics/DebugTraceReporter.ts`
- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Modify: `apps/cli/src/infra/player/PlayerServiceImpl.ts`
- Test: `apps/cli/test/unit/services/diagnostics/DiagnosticsStoreImpl.test.ts`
- Test: `apps/cli/test/unit/services/diagnostics/DebugTraceReporter.test.ts`

- [x] Define stable event names for playback and source resolution:
  - `playback.restart.requested`
  - `playback.recover.requested`
  - `playback.refresh.requested`
  - `playback.refresh.cooldown`
  - `resolve.cache.hit`
  - `resolve.cache.miss`
  - `resolve.cache.stale`
  - `resolve.cache.invalidated`
  - `resolve.refetch.started`
  - `resolve.refetch.succeeded`
  - `resolve.refetch.failed`
  - `playback.fallback.started`
  - `playback.fallback.succeeded`
  - `presence.update.succeeded`
  - `presence.clear.failed`
- [x] Ensure each event can carry `sessionId`, `playbackCycleId`, `providerAttemptId`, `traceId`, `titleId`, `season`, and `episode` when known.
- [x] Redact raw URLs, headers, cookies, query tokens, and referers in default trace/support exports.
- [x] Existing diagnostics tests cover redaction; new panel tests cover cache-decision projection.
- [x] Include in the scoped implementation commit.

## Task 4: Summary-First Diagnostics Panel

**Files:**

- Modify: `apps/cli/src/app-shell/overlay-panel.tsx`
- Modify: `apps/cli/src/app-shell/workflows.ts`
- Modify: `apps/cli/src/services/diagnostics/DiagnosticsServiceImpl.ts`
- Test: `apps/cli/test/unit/services/diagnostics/diagnostics-summary.test.ts`

- [x] Add a summary projection that groups recent diagnostics into:
  - Playback
  - Provider
  - Cache
  - Discord
  - Downloads
  - Network
- [x] Each group reports `OK`, `Needs attention`, or `Failed`, one plain-English reason, and one suggested action.
- [x] Keep the existing technical detail below the summary.
- [x] Add section boundary so developers can still inspect event timeline and redacted metadata.
- [x] Ensure the default view answers: `Is Kunai okay? If not, what should I do?`
- [x] Include in the scoped implementation commit.

## Task 5: Storage Maintenance Safety Layer

**Files:**

- Create: `packages/storage/src/maintenance.ts`
- Modify: `packages/storage/src/index.ts`
- Create: `apps/cli/src/services/persistence/StorageMaintenanceService.ts`
- Modify: `apps/cli/src/container.ts`
- Modify: `apps/cli/src/main.ts`
- Test: `packages/storage/test/storage-maintenance.test.ts`
- Test: `apps/cli/test/unit/services/persistence/StorageMaintenanceService.test.ts`
- Docs: `.docs/architecture.md`
- Docs: `.plans/storage-hardening.md`

- [x] Add storage maintenance that prunes only expired cache tables:
  - `stream_cache`
  - `source_inventory`
  - `recommendation_cache`
  - `schedule_cache`
- [x] Cap `resolve_traces` by count.
- [x] Prune stale `provider_health` by conservative age.
- [x] Run `PRAGMA optimize` for data and cache DBs.
- [x] Allow passive WAL checkpoint when explicitly requested by maintenance options.
- [x] Do not run automatic `VACUUM`.
- [x] Do not touch durable user data tables automatically.
- [x] Run maintenance opportunistically at startup as a background task after container bootstrap, not in the hot playback path.
- [x] Record diagnostics if maintenance fails; never crash app startup because cache cleanup failed.
- [x] Add tests that seed durable and cache tables, run maintenance, and assert durable rows remain.
- [x] Include in the scoped implementation commit.

## Task 6: Continuation And New-Episode Projection

**Files:**

- Create: `apps/cli/src/services/continuation/ContinuationProjectionService.ts`
- Create: `apps/cli/src/services/continuation/continuation-policy.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/app-shell/history-shell.tsx`
- Modify: `apps/cli/src/app-shell/workflows.ts`
- Test: `apps/cli/test/unit/services/continuation/continuation-policy.test.ts`
- Test: `apps/cli/test/unit/launch-entry.test.ts`
- Docs: `.plans/search-offline-continuation-engines.md`

- [x] Keep `history_progress` as immutable playback fact per episode.
- [x] Build a derived projection:
  - newest unfinished episode first
  - if latest completed and next episode is released, show next episode as continuable
  - if next episode is upcoming, show date/status but do not autoplay it
  - if fully caught up, mark up-to-date
- [x] Keep the projection pure so cached schedule/catalog data can be supplied without provider calls.
- [x] Leave visible/relevant title sync to the caller; stale values are acceptable briefly.
- [x] Add tests for weekly release recalibration where episode 5 is completed and episode 6 later becomes available.
- [x] Include in the scoped implementation commit.

## Task 7: Docs, Release Gate, And Final Verification

**Files:**

- Modify: `.docs/testing-strategy.md`
- Modify: `.docs/debugging-map.md`
- Modify: `.docs/diagnostics-guide.md`
- Modify: `.docs/presence-integrations.md` if Discord diagnostics shape changes.
- Modify: `.plans/plan-implementation-truth.md`
- Modify: `.plans/roadmap.md`

- [x] Document the playback command contract.
- [x] Document diagnostics redaction and sensitive local export policy.
- [x] Document storage maintenance safety: automatic cleanup never deletes user-owned facts.
- [x] Update plan truth index if any plan status changes.
- [x] Run targeted tests after each task.
- [x] Run final deterministic gate:
  - `bun run typecheck`
  - `bun run lint`
  - `bun run fmt:check`
  - `bun run test`
  - `bun run build`
- [x] Run or update opt-in manual smoke checklist for:
  - restart/recover/refresh/fallback playback behavior
  - Discord presence clear/update behavior when changed
  - one provider smoke per touched engine near release time only
- [x] Commit docs and verification updates with the implementation sweep.

Final gate evidence from 2026-05-17:

- `bun run typecheck`: passed, 7 successful tasks.
- `bun run lint`: passed, 7 successful tasks and 0 lint errors.
- `bun run fmt`: passed, 7 successful tasks.
- `bun run fmt:check`: passed, 7 successful tasks.
- `bun run test`: passed, 715 CLI tests plus package tests; 13 successful turbo tasks.
- `bun run build`: passed, `dist/kunai.js` built.

---

## Completion Criteria

- Restart is instant/local when possible and does not refetch by default.
- Recover refetches same intent first, resumes near last trusted position, and falls back only after repair fails.
- Refresh Source is advanced-only, soft-cooldown protected, and non-disruptive when current playback is still usable.
- Diagnostics show summary-first health for normal users and correlated technical trails for developers.
- Default diagnostics exports are redacted but still useful.
- Storage maintenance is safe, tested, and cannot corrupt/delete user-owned facts automatically.
- Continuation projections can show unfinished episodes and newly released next episodes without mutating historical watch facts.
- Final deterministic verification passes.
