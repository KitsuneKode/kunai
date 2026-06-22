# Plan 003: Session State Selector Adoption

Status: partially implemented
Priority: P1
Effort: M
Risk: Medium
Created: 2026-06-22

## Problem

Kunai already has a real session state manager and a `useSyncExternalStore` bridge, but several UI paths still use separate manual state planes.

Current evidence:

- `apps/cli/src/domain/session/SessionStateManager.ts` exposes `getState`, `dispatch`, and `subscribe`.
- `apps/cli/src/app-shell/use-session-selector.ts` already implements `useSessionSelector(...)` using `useSyncExternalStore`.
- `apps/cli/src/app-shell/ink-shell.tsx` wraps it with `useSessionState`.
- The same file still has `rootShellSubscribers`, `rootShellScreen`, `setRootShellScreen`, and revision-based re-rendering for manually mounted root screens.
- `apps/cli/src/app-shell/root-overlay-bridge.ts`, `session-picker.ts`, and `workflows.ts` already show better state-manager subscription patterns for modal/picker completion.

This means the UI has two truth planes: reducer-managed session state and imperative root shell screens. That is a source of stale reads, order-dependent rendering, and awkward cleanup.

## Goal

Adopt `useSessionSelector` as the standard UI subscription primitive and migrate one imperative root-shell path at a time into declarative `SessionState` overlays or root content state.

## Non-Goals

- Do not rewrite the whole reducer.
- Do not move every local picker index/filter state into `SessionState`.
- Do not split `ink-shell.tsx` only for aesthetics in this slice.
- Do not change provider/session behavior while migrating rendering paths.

## Design

Use the existing selector bridge:

```ts
const activeModals = useSessionSelector(
  container.stateManager,
  (state) => state.activeModals,
  shallowEqual,
);
```

Rules:

- Components should subscribe to the narrowest state slice they need.
- Imperative flows may still await picker results through existing bridge helpers, but rendering should come from reducer state.
- New cross-screen UI state should be represented as `SessionState` or a focused app-shell store, not module-global React subscriber sets.
- Manual revision bumps should be deleted only after equivalent reducer state and tests exist.

## Implementation Steps

1. Add or reuse a tiny `shallowEqual` helper for selector outputs where needed.
2. Update one low-risk root-shell screen path to render from state instead of `setRootShellScreen`.
   - Recommended first candidate: diagnostics/help/about style screens, not provider track picker.
3. Replace that path's `rootShellSubscribers` dependency with a `SessionState` overlay action.
4. Add a test proving opening and closing that screen updates reducer state and rendered overlay selection.
5. After the first slice lands, repeat for one picker-like path that currently uses `setRootShellScreen`.
6. Once no call sites need it, remove `rootShellSubscribers`, `rootShellScreen`, and `setRootShellScreen`.

## Tests

Add or extend:

- `apps/cli/test/unit/app-shell/use-session-selector.test.ts`
  - selector callback only fires when selected value changes
  - custom equality prevents unnecessary updates
- Session reducer tests for the migrated overlay/screen actions.
- A focused Ink render test only for the migrated screen if existing test harness supports it; otherwise keep the first test at reducer/selector level.

## Verification

Run after each migration slice:

```sh
bun run --cwd apps/cli test:file test/unit/app-shell/use-session-selector.test.ts
bun run typecheck
bun run lint
bun run fmt:check
bun run test
```

## Acceptance Criteria

- At least one current `setRootShellScreen` flow renders from reducer-backed state instead.
- `useSessionSelector` is imported by the migrated surface instead of local revision state.
- The migrated screen closes through reducer actions, not module-global subscriber notification.
- No provider picker or playback behavior changes in this slice.

## Implemented Slice

- `use-session-selector.ts` now exports a tested `shallowEqual` helper for object selectors.
- Root-owned overlay lookup in `AppRoot` now uses `useSessionSelector(...)` directly.
- Existing root overlays already open and close through `SessionState.activeModals`; the remaining work is to migrate mounted helper screens/root content sessions off module-global subscriber sets one flow at a time.
- `root-content-state.ts` now exposes `subscribeRootContentSession(...)` and `useRootContentSession()` uses `useSyncExternalStore(...)` instead of a manual local revision bump.
- `apps/cli/test/unit/app-shell/root-content-state.test.ts` covers root-content subscription notifications.

Remaining:

- Migrate `rootShellScreen` / `rootShellSubscribers` in `ink-shell.tsx` or delete them after converting the remaining helper screen flows.
- Decide whether long-lived root content belongs in `SessionState` proper or in the focused root-content external store.

## Rollback

Because the first migration should be one screen path, rollback is restoring that screen's previous `setRootShellScreen` call and removing the new reducer action/tests. Avoid batching multiple screen migrations into one PR.
