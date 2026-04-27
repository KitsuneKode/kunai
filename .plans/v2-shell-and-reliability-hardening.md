# V2 Shell & Reliability Hardening Plan

This plan outlines the transition from imperative shell orchestration to a persistent, state-driven architecture to eliminate UI bugs (like shell piling) and improve application robustness.

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
- **NEW**: `<AppErrorBoundary />` component.
- **Behavior**: If a provider resolution fails or a scraper crashes, instead of exiting to the terminal prompt, the app will transition to an **Error Phase**.
- **UI**: Display a diagnostic card with the error message and a `[R] Retry` / `[ESC] Back` interaction.

### 3. Terminal Polish & Cleanup
- **Phase Transitions**: Implement an explicit `clearScreen` on every major phase transition (e.g., Search -> Playback).
- **Identity Consistency**: Ensure the "🦊 KitsuneSnipe" logo is only rendered once at the top level of `<AppRoot />` to prevent duplication.

### 4. Code Manipulation Improvements
- **Strict Typing**: Audit all `Provider` definitions and eliminate remaining `any` usages in stream/subtitle resolution.
- **Registry Hardening**: Ensure `ProviderRegistry` can gracefully handle missing or misconfigured providers without crashing the controller.

## Verification Plan

### Manual Verification
- **Stress Test Transitions**: Rapidly switch between episodes (Next/Prev) to verify no UI pile-up or "🦊 KitsuneSnipe" duplication.
- **Simulate Failures**: Force a provider to throw an error and verify the Error Boundary UI triggers instead of a process crash.
- **Resize Testing**: Verify the state-driven UI adapts correctly to terminal resize events without breaking the layout.
