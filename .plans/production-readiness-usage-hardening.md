# Production Readiness Usage Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Kunai's playback recovery, provider fallback, offline suggestions, diagnostics, and developer debugging feel reliable for real users without hiding decisions or over-automating provider switches.

**Architecture:** Route recovery choices through a single policy layer, feed the shell with typed user-facing recovery state, and keep diagnostics/export/reporting on the same redacted event bundle. Playback should remain optimistic when a stream is playable, conservative when evidence is ambiguous, and explicit when switching providers or asking users to act.

**Tech Stack:** Bun, TypeScript, Ink, mpv IPC telemetry, existing diagnostics services, SQLite-backed stores, `bun test`, `turbo`.

---

## Product Rules

- Playable video wins over optional metadata, subtitles, recommendations, artwork, and diagnostics.
- Automatic fallback happens only after a clear provider/cache/playback failure or in explicit `fallback-first` mode.
- Slow once is not failure. Repeated starvation with evidence becomes a recovery prompt or fallback candidate.
- Local offline/DNS/user-cancel/runtime issues never degrade provider health.
- Offline library suggestions appear only in online/search/playback contexts when the network is unavailable or limited.
- Normal users see plain recovery actions; power users and maintainers get trace/export detail.
- Long sessions must keep bounded queues, bounded diagnostics, bounded artwork work, and deduped in-flight resolves.

## Current Foundation

- `apps/cli/src/domain/recovery/RecoveryPolicy.ts` exists and is unit-tested.
- `apps/cli/src/services/network/NetworkStatus.ts` exists and is unit-tested.
- `apps/cli/src/services/diagnostics/support-bundle.ts` has layered summaries.
- `docs/developer/debugging-workflow.mdx` exists.
- Playback resolve now persists `consecutiveFailures`, skips down fallback providers, and passes abort signals into stream health checks.
- Offline library preview helpers can avoid remote artwork while offline.

## Slice 1: Wire Recovery Policy Into Playback Resolve

**Files:**

- Modify: `apps/cli/src/services/playback/PlaybackResolveService.ts`
- Modify: `apps/cli/src/services/playback/PlaybackResolveCoordinator.ts`
- Modify: `apps/cli/src/domain/provider/ProviderFailureClassifier.ts`
- Test: `apps/cli/test/unit/services/playback/playback-resolve-service.test.ts`
- Test: `apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts`
- Test: `apps/cli/test/unit/domain/recovery/recovery-policy.test.ts`

- [x] **Step 1: Add failing tests for policy-routed recovery**

  Add tests that prove:
  - fresh cache returns without provider work
  - stale cache validates before resolve
  - health-failed cache resolves primary first
  - health-timeout with playable stream proceeds with warning
  - automatic mode skips down provider health
  - explicit provider can try a down provider once
  - manual mode asks instead of auto-fallback after provider failure

  Run:

  ```sh
  bun test apps/cli/test/unit/domain/recovery/recovery-policy.test.ts apps/cli/test/unit/services/playback/playback-resolve-service.test.ts apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts
  ```

  Expected: new tests fail before wiring.

- [x] **Step 2: Introduce a playback recovery decision adapter**

  Create a small adapter near playback resolve, not inside Ink UI:

  ```ts
  type PlaybackRecoveryDecisionContext = {
    readonly cache: "none" | "fresh" | "stale" | "validated" | "health-timeout" | "health-failed";
    readonly mode: RecoveryMode;
    readonly intent: RecoveryIntent;
    readonly network: NetworkAvailability;
    readonly providerHealthStatus?: "healthy" | "degraded" | "down" | "unknown";
    readonly failureClass?: RecoveryFailureClass | null;
    readonly retryCount?: number;
    readonly fallbackCount?: number;
    readonly playableStreamAvailable?: boolean;
    readonly compatibleProviderAvailable?: boolean;
  };
  ```

  The adapter should call `decideRecovery()` and return the exact decision plus a user-facing reason string. Do not duplicate policy branches in `PlaybackResolveService`.

- [x] **Step 3: Route fallback candidate selection through policy outcomes**

  Keep `PlaybackResolveService` responsible for provider candidate IDs, but make down-provider handling match the policy:
  - automatic path skips `down`
  - explicit provider path includes the selected provider once
  - degraded remains eligible
  - incompatible `mediaKind` remains excluded

- [x] **Step 4: Emit diagnostics for each recovery decision**

  Record diagnostics events with:
  - `category: "provider"` or `"playback"`
  - decision
  - reason
  - provider id
  - cache state
  - whether the user should see it

  Keep event attributes bounded and redacted.

- [x] **Step 5: Verify**

  Run:

  ```sh
  bun test apps/cli/test/unit/domain/recovery/recovery-policy.test.ts apps/cli/test/unit/services/playback/playback-resolve-service.test.ts apps/cli/test/unit/services/playback/playback-resolve-coordinator.test.ts
  bun run typecheck
  ```

## Slice 2: Slow-But-Healthy Playback Recovery

**Files:**

- Modify: `apps/cli/src/infra/player/playback-watchdog.ts`
- Modify: `apps/cli/src/infra/player/playback-failure-classifier.ts`
- Modify: `apps/cli/src/infra/player/playback-telemetry-snapshot.ts`
- Modify: `apps/cli/src/app/PlaybackPhase.ts`
- Test: `apps/cli/test/unit/infra/player/playback-watchdog.test.ts`
- Test: `apps/cli/test/unit/infra/player/playback-failure-classifier.test.ts`
- Test: `apps/cli/test/unit/app/playback-session-controller.test.ts`

- [x] **Step 1: Add tests for repeated starvation**

  Cover:
  - one short buffer event does not trigger fallback
  - repeated `paused-for-cache` plus zero read rate becomes `stream-stalled`
  - network-read-dead becomes refresh-first, then fallback only after refresh fails
  - user pause suppresses stall classification

- [x] **Step 2: Add a bounded slow-stream state model**

  Use the existing watchdog signals to classify:
  - `buffering-observed`
  - `slow-network-suspected`
  - `stream-stalled`
  - `stream-dead`

  Do not add timers in Ink render paths. Timers belong in player/watchdog services.

- [x] **Step 3: Map slow-stream state to user actions**

  Recommended actions:
  - `buffering-observed`: wait silently or show subtle status
  - `slow-network-suspected`: show diagnostics hint, no provider penalty
  - `stream-stalled`: offer refresh source
  - `stream-dead`: refresh first, then offer fallback provider

- [x] **Step 4: Verify**

  Run:

  ```sh
  bun test apps/cli/test/unit/infra/player/playback-watchdog.test.ts apps/cli/test/unit/infra/player/playback-failure-classifier.test.ts apps/cli/test/unit/app/playback-session-controller.test.ts
  ```

## Slice 3: Network-Aware User Messaging And Offline Suggestion

**Files:**

- Modify: `apps/cli/src/services/network/NetworkStatus.ts`
- Modify: `apps/cli/src/domain/continuation/ContinuationEngine.ts`
- Modify: `apps/cli/src/domain/session/command-registry-contexts.ts`
- Modify: `apps/cli/src/app-shell/panel-data.ts`
- Modify: `apps/cli/src/app-shell/root-status-summary.ts`
- Test: `apps/cli/test/unit/services/network/network-status.test.ts`
- Test: `apps/cli/test/unit/domain/continuation/continuation-engine.test.ts`
- Test: `apps/cli/test/unit/domain/session/command-registry-contexts.test.ts`
- Test: `apps/cli/test/unit/app-shell/panel-data.test.ts`

- [x] **Step 1: Add tests for offline suggestions**

  Cover:
  - search/playback network unavailable suggests offline library
  - offline library itself does not show an internet warning
  - local continuation remains first when a downloaded next episode is ready
  - limited network says retry or offline, not provider down

- [x] **Step 2: Add a user-facing network hint model**

  Shape:

  ```ts
  type NetworkUserHint = {
    readonly tone: "neutral" | "warning";
    readonly title: string;
    readonly detail: string;
    readonly actions: readonly ("offline-library" | "retry" | "diagnostics" | "back")[];
  };
  ```

  Generate this from `NetworkStatus.ts`; do not build copy independently in UI files.

- [x] **Step 3: Surface the hint in shell panels**

  Add compact status text and command availability. Avoid modal interruption unless the user's current action cannot continue.

- [x] **Step 4: Verify**

  Run:

  ```sh
  bun test apps/cli/test/unit/services/network/network-status.test.ts apps/cli/test/unit/domain/continuation/continuation-engine.test.ts apps/cli/test/unit/domain/session/command-registry-contexts.test.ts apps/cli/test/unit/app-shell/panel-data.test.ts
  ```

## Slice 4: Recovery Mode Settings UX

**Files:**

- Modify: `apps/cli/src/app-shell/overlay-panel.tsx`
- Modify: `apps/cli/src/app-shell/workflows.ts`
- Modify: `apps/cli/src/app-shell/panel-data.ts`
- Test: `apps/cli/test/unit/app-shell/overlay-panel.test.ts`
- Test: `apps/cli/test/unit/app-shell/panel-data.test.ts`
- Test: `apps/cli/test/unit/services/persistence/ConfigServiceImpl.test.ts`

- [x] **Step 1: Add settings tests**

  Cover:
  - settings exposes recovery mode choices
  - default is `guided`
  - choosing `manual` persists
  - choosing `fallback-first` describes faster automatic fallback plainly

- [x] **Step 2: Add settings copy**

  Copy:
  - Guided: `Balanced recovery`
  - Fallback-first: `Fast fallback`
  - Manual: `Ask before switching`

  Detail:
  - Guided: `Retry once, then recover when the issue is clear.`
  - Fallback-first: `Switch providers faster after slow or failed resolves.`
  - Manual: `Never switch providers without asking.`

- [x] **Step 3: Wire settings save through existing config flow**

  Use `ConfigServiceImpl.update({ recoveryMode })`. Do not introduce a second config path.

- [x] **Step 4: Verify**

  Run:

  ```sh
  bun test apps/cli/test/unit/app-shell/overlay-panel.test.ts apps/cli/test/unit/app-shell/panel-data.test.ts apps/cli/test/unit/services/persistence/ConfigServiceImpl.test.ts
  ```

## Slice 5: Diagnostics Panel, Export, And Report Issue Flow

**Files:**

- Modify: `apps/cli/src/services/diagnostics/support-bundle.ts`
- Create: `apps/cli/src/services/diagnostics/IssueReportBuilder.ts`
- Modify: `apps/cli/src/app-shell/workflows.ts`
- Modify: `apps/cli/src/app-shell/panel-data.ts`
- Modify: `.docs/diagnostics-guide.md`
- Modify: `docs/developer/debugging-workflow.mdx`
- Test: `apps/cli/test/unit/services/diagnostics/support-bundle.test.ts`
- Test: `apps/cli/test/unit/services/diagnostics/issue-report-builder.test.ts`
- Test: `apps/cli/test/unit/app-shell/panel-data.test.ts`

- [x] **Step 1: Add issue report builder tests**

  Cover:
  - generated issue title includes failure area, not raw URL
  - generated body includes bundle summary, redacted timeline, version/runtime info
  - generated body excludes signed query values, local home paths, and full stream URLs

- [x] **Step 2: Implement `IssueReportBuilder`**

  Build a pure helper:

  ```ts
  type IssueReportDraft = {
    readonly title: string;
    readonly body: string;
    readonly diagnosticsPath?: string;
    readonly issueUrl: string;
  };
  ```

  It should create a GitHub issue URL but not open the browser by itself. Opening belongs in workflow code and should remain optional.

- [x] **Step 3: Make diagnostics panel action-oriented**

  Panel sections should show:
  - current symptom
  - likely owner: user network, provider, cache, mpv/runtime, unknown
  - safe next actions
  - export/report commands

- [x] **Step 4: Verify**

  Run:

  ```sh
  bun test apps/cli/test/unit/services/diagnostics/support-bundle.test.ts apps/cli/test/unit/services/diagnostics/issue-report-builder.test.ts apps/cli/test/unit/app-shell/panel-data.test.ts
  ```

## Slice 6: Offline Artwork Cache Without Hidden Network Work

**Files:**

- Modify: `apps/cli/src/services/download/DownloadService.ts`
- Modify: `apps/cli/src/services/offline/offline-library.ts`
- Create: `apps/cli/src/services/offline/offline-artwork-cache.ts`
- Modify: `apps/cli/src/app-shell/image-pane.ts`
- Test: `apps/cli/test/unit/services/download/download-service.test.ts`
- Test: `apps/cli/test/unit/services/offline/offline-library.test.ts`
- Test: `apps/cli/test/unit/app-shell/image-pane.test.ts`

- [x] **Step 1: Add artwork cache tests**

  Cover:
  - local thumbnail wins
  - cached poster file wins over remote poster while offline
  - remote poster is used only when online and previews are enabled
  - failed artwork cache does not fail download completion
  - repeated library render does not trigger N+1 remote fetches

- [x] **Step 2: Implement local cached poster artifact**

  Store poster cache path as derived local metadata when possible. Keep `posterUrl` as provenance, not as the offline-first display dependency.

- [x] **Step 3: Dedupe artwork work**

  Use a bounded in-flight map keyed by poster URL or title id. Clear entries on completion/failure.

- [x] **Step 4: Verify**

  Run:

  ```sh
  bun test apps/cli/test/unit/services/download/download-service.test.ts apps/cli/test/unit/services/offline/offline-library.test.ts apps/cli/test/unit/app-shell/image-pane.test.ts
  ```

## Slice 7: Provider And Player Harness Matrix

**Files:**

- Create: `apps/cli/test/unit/harness/playback-recovery-harness.test.ts`
- Create: `apps/cli/test/unit/harness/provider-fallback-harness.test.ts`
- Modify: `apps/cli/test/live/README.md`
- Modify: `.plans/provider-player-harness-test-matrix.md`

- [x] **Step 1: Add deterministic harness scenarios**

  Add tests for:
  - fast healthy stream
  - healthy probe but slow playback
  - fresh cache expired in player
  - stale cache health failed
  - provider timeout
  - provider blocked
  - provider empty
  - user offline
  - user cancel during health check
  - long autoplay session with bounded diagnostics

- [x] **Step 2: Add live smoke checklist**

  Document live checks for the active providers without making CI depend on remote providers.

- [x] **Step 3: Verify**

  Run:

  ```sh
  bun test apps/cli/test/unit/harness/playback-recovery-harness.test.ts apps/cli/test/unit/harness/provider-fallback-harness.test.ts
  bun run --cwd apps/cli test:unit
  ```

## Slice 8: Developer Debug Session Command

**Files:**

- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/app-shell/workflows.ts`
- Modify: `apps/cli/src/services/diagnostics/DebugTraceReporter.ts`
- Modify: `docs/developer/debugging-workflow.mdx`
- Test: `apps/cli/test/unit/main-args.test.ts`
- Test: `apps/cli/test/unit/services/diagnostics/DebugTraceReporter.test.ts`

- [x] **Step 1: Add CLI argument tests**

  Cover a `--debug-session` or equivalent command that enables trace categories, writes an exportable diagnostics path, and keeps normal playback behavior unchanged.

- [x] **Step 2: Implement debug session mode**

  Behavior:
  - enables existing debug trace reporter
  - records startup config summary
  - records diagnostics export path
  - prints concise developer instructions only in debug mode
  - does not add normal user noise

- [x] **Step 3: Document breakpoint workflow**

  Update `docs/developer/debugging-workflow.mdx` with:
  - `bun --inspect-brk`
  - how to set breakpoints in provider resolve and playback recovery
  - how to export a support bundle after reproducing

- [x] **Step 4: Verify**

  Run:

  ```sh
  bun test apps/cli/test/unit/main-args.test.ts apps/cli/test/unit/services/diagnostics/DebugTraceReporter.test.ts
  ```

## Final Verification

Run:

```sh
bun run typecheck
bun run lint
bun run fmt:check
bun run --cwd apps/cli test:unit
bun run test
```

Expected:

- Typecheck passes.
- Lint reports 0 errors.
- Format check passes.
- Unit tests pass.
- Package test suite passes.

## Completion Definition

- Recovery decisions in playback are traceable to `RecoveryPolicy`.
- Slow-but-healthy streams are handled by player evidence, not provider guesswork.
- Offline suggestions are visible only when useful and never block offline library use.
- Recovery mode is configurable from the UI.
- Diagnostics panel, export, and issue report share one redacted bundle model.
- Downloaded artwork prefers local artifacts and avoids hidden network fetches offline.
- Harness tests cover weird real-world playback/provider/network behavior.
- Developer debugging has a documented, repeatable trace + breakpoint + export workflow.
