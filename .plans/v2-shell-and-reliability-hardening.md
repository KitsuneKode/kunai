# V2 Shell & Reliability Hardening Plan

This plan outlines the transition from imperative shell orchestration to a persistent, state-driven architecture to eliminate UI bugs (like shell piling) and improve application robustness.

## Status (AD11 Task 13 — 2026-07-10)

**Actionable ErrorShell gap closed.** Playback/provider failures already flow `playbackProblem` → `toErrorScenario` → `ErrorShell` with consistent `r` retry (when recovery is possible) and Enter/Esc dismiss. Coverage now includes provider-empty, provider-timeout, and user-cancelled scenarios; `errorShellOffersRetry` gates the retry binding. A thin `SoftFailBoundary` (`componentDidCatch`, &lt;50 LOC) wraps `RootContentBody` so child render throws fail soft into dismissible ErrorShell copy.

**Deferred:** a full React `<AppErrorBoundary />` architecture (dedicated error phase, recovery orchestration beyond playbackProblem) remains out of scope — see §2 below. Do not invent a new boundary stack; extend the existing ErrorShell path instead.

## User Review Required

> [!IMPORTANT]
> This involves a significant refactor of how `ink-shell.tsx` manages the terminal lifecycle. Instead of sequential `openShell()` calls, the app will maintain a single persistent Ink instance.

## Proposed Changes

### 1. State-Driven UI Orchestration

Currently, `SessionController` manually opens and closes shells (`Home`, `Playback`, `Loading`). This leads to "Shell Piling" where old UI elements remain in the terminal buffer.

- **Refactor `ink-shell.tsx`**: Create a single `<AppRoot />` component.
- **Phase Mapping**: `<AppRoot />` will switch between sub-shells based on `stateManager.getState().phase` (`searching`, `results`, `playback`, `loading`).
- **Persistence**: The Ink instance stays alive for the entire session, ensuring perfectly clean transitions and 100% control over the terminal buffer.

### 2. Robust Error Boundaries

- **DEFERRED**: Full `<AppErrorBoundary />` component / dedicated Error Phase architecture.
- **LANDED (AD11 Task 13 substitute):** `playbackProblem` → `ErrorShell` recovery actions + thin `SoftFailBoundary` around root content in `root-content-shell.tsx`.
- **Behavior (landed):** Provider resolve / playback failures transition to the existing error surface with diagnostic waterfall, `[R] Retry` when recoverable, and `[Enter]/[Esc] Back/dismiss`.
- **UI**: Scenario-aware copy for timeout, provider-empty, offline, session, stream-broken, and user-cancelled.

### 3. Terminal Polish & Cleanup

- **Phase Transitions**: Implement an explicit `clearScreen` on every major phase transition (e.g., Search -> Playback).
- **Identity Consistency**: Ensure the "🦊 KitsuneSnipe" logo is only rendered once at the top level of `<AppRoot />` to prevent duplication.

### 4. Code Manipulation Improvements

- **Strict Typing**: Audit all `Provider` definitions and eliminate remaining `any` usages in stream/subtitle resolution.
- **Registry Hardening**: Ensure `ProviderRegistry` can gracefully handle missing or misconfigured providers without crashing the controller.

## Verification Plan

### Manual Verification

- **Stress Test Transitions**: Rapidly switch between episodes (Next/Prev) to verify no UI pile-up or "🦊 KitsuneSnipe" duplication.
- **Simulate Failures**: Force a provider to throw an error and verify the ErrorShell UI triggers instead of a process crash.
- **Resize Testing**: Verify the state-driven UI adapts correctly to terminal resize events without breaking the layout.

### Automated (AD11 Task 13)

- `bun run --cwd apps/cli test -- test/unit/app/playback-problem.test.ts`
- `bun run --cwd apps/cli test -- test/unit/app-shell/error-shell.test.tsx`
