# Playback Source Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit playback recompute path that bypasses stale stream/source state, ignores provider memory for that action, and asks VidKing to probe the wider source set.

**Architecture:** Keep normal playback bounded and fast. Route explicit `/recompute` intent through player control into `PlaybackPhase`, then into `PlaybackResolveService` as `refresh` provider intent with provider-health bypass. VidKing treats `refresh` intent as exhaustive source cycling across its flavor list.

**Tech Stack:** Bun, Ink shell, `@kunai/core` provider cycle engine, direct HTTP providers, SQLite-backed stream/source caches.

---

### Task 1: Command And Player-Control Contract

**Files:**

- Modify: `apps/cli/src/domain/session/command-registry.ts`
- Modify: `apps/cli/src/app-shell/types.ts`
- Modify: `apps/cli/src/app-shell/command-router.ts`
- Modify: `apps/cli/src/infra/player/PlayerControlService.ts`
- Modify: `apps/cli/src/infra/player/PlayerControlServiceImpl.ts`
- Test: `apps/cli/test/unit/domain/session/SessionState.test.ts`

- [x] Add failing command tests for `/recompute` and `/bypass-cache`.
- [x] Add `recompute` to command ids, active playback, and post-playback contexts.
- [x] Route command palette action to `recompute`.
- [x] Add `recomputeCurrentPlayback()` to player control.

### Task 2: Resolve-Time Bypass And Refresh Intent

**Files:**

- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Modify: `apps/cli/src/app/playback-session-controller.ts`
- Modify: `apps/cli/src/services/playback/PlaybackResolveService.ts`
- Modify: `apps/cli/src/services/playback/ProviderCandidatePlanner.ts`
- Test: `apps/cli/test/unit/services/playback/provider-candidate-planner.test.ts`
- Test: `apps/cli/test/unit/services/playback/playback-resolve-service.test.ts`

- [x] Add failing tests for provider-health bypass and refresh resolve intent.
- [x] Treat `recompute` as a source refresh control action.
- [x] Invalidate current stream/source inventory and bypass title/provider health for recompute.
- [x] Send provider `refresh` intent for recompute.

### Task 3: VidKing Exhaustive Source Cycle

**Files:**

- Modify: `packages/providers/src/vidking/direct.ts`
- Test: `packages/providers/test/providers.test.ts`

- [x] Add failing provider test proving refresh intent reaches non-Phase-A VidKing flavors.
- [x] Build flavor-backed cycle candidates for refresh intent.
- [x] Preserve normal Phase A startup behavior for standard playback.

### Task 4: Verification

**Files:**

- No new production files.

- [x] Run focused playback/provider tests.
- [x] Run `bun run typecheck`.
- [x] Run `bun run lint`.
- [x] Run `bun run fmt:check`.
- [x] Run `bun run build`.
- [x] Run `bun run test`.
