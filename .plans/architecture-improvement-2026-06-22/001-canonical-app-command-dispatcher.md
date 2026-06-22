# Plan 001: Canonical App Command Dispatcher

Status: ready
Priority: P0
Effort: M
Risk: Medium
Created: 2026-06-22

## Problem

Kunai has a typed command registry, but command effects are still executed from multiple UI surfaces. The palette, playback footer, post-playback footer, and direct hotkeys can drift because they do not share one canonical action dispatcher.

Current evidence:

- `apps/cli/src/domain/session/command-registry.ts` defines `AppCommandId`, `COMMANDS`, and `COMMAND_CONTEXTS`.
- `apps/cli/src/app-shell/commands.ts` resolves context-specific commands.
- `apps/cli/src/app-shell/shell-command-input.ts` turns palette selection into `toShellAction(resolved.id)`.
- `apps/cli/src/app-shell/ink-shell.tsx` still has a long local command execution block for active playback actions such as `next`, `fallback`, `provider`, `source`, `quality`, `download`, and `quit`.
- `apps/cli/src/app-shell/root-overlay-shell.tsx` also has command resolution and overlay-local action execution.

This makes the UX feel nondeterministic: a visible command can be enabled in one place, unavailable in another, or execute slightly different code depending on whether it came from `/`, a footer key, or a surface-specific handler.

## Goal

Create one canonical app-shell command dispatcher that maps `AppCommandId` plus a typed command source/context into an effect. All palette selections, footer actions, direct hotkeys, and post-playback actions should enter through this dispatcher before calling player control, provider picker workflows, download workflows, diagnostics, or shell navigation.

## Non-Goals

- Do not add user-configurable keybindings.
- Do not rewrite all Ink surfaces in this pass.
- Do not change command labels or aliases unless a command is provably wrong.
- Do not change mpv Lua-owned playback shortcuts.
- Do not move provider picker policy back into UI files; keep the recent `playback-provider-switch` app policy direction.

## Design

Add an app-shell command dispatch module, for example:

```ts
export type AppCommandSource =
  | "palette"
  | "footer"
  | "hotkey"
  | "post-playback"
  | "picker"
  | "runtime";

export type AppCommandDispatchContext = {
  readonly container: Container;
  readonly state: SessionState;
  readonly commandContext: CommandContextId;
  readonly source: AppCommandSource;
  readonly reason: string;
  readonly setExiting?: (value: boolean) => void;
};

export async function dispatchAppCommand(
  commandId: AppCommandId,
  context: AppCommandDispatchContext,
): Promise<"handled" | "ignored" | "disabled">;
```

Rules:

- Always check `resolveCommandContext(state, commandContext)` before executing user-visible commands.
- Return `"disabled"` with a reason when a command exists but cannot run.
- Keep command execution effects small and delegated:
  - player actions go through `container.playerControl`
  - provider/source/quality/subtitle pickers go through existing workflows/policies
  - search/root actions go through the existing command router until those are extracted
  - downloads go through existing download workflow
- Keep the dispatcher side-effectful, but keep availability/context resolution pure and covered by tests.

## Implementation Steps

1. Add `apps/cli/src/app-shell/app-command-dispatcher.ts`.
2. Move the active playback command execution block from `ink-shell.tsx` into dispatcher handlers without changing behavior.
3. Route `useShellInput(... onResolve)` call sites through `dispatchAppCommand` when the action maps to `AppCommandId`.
4. Route post-playback commands through the same dispatcher.
5. Keep `routeSearchShellAction` as a delegated fallback for root/search actions during this slice.
6. Add a small result surface for disabled commands so callers can show or log the reason consistently.
7. Delete duplicated command cases only after their caller is routed through the dispatcher.

## Tests

Add or extend unit tests around pure command routing before touching the large surfaces:

- `apps/cli/test/unit/domain/session/command-registry-contexts.test.ts`
  - command appears only in intended contexts
  - disabled reasons are stable for active playback commands with no stream
- New `apps/cli/test/unit/app-shell/app-command-dispatcher.test.ts`
  - `/fallback` and fallback hotkey dispatch the same command id and reason string
  - `source`, `quality`, `provider`, `audio`, and `subtitle` all call the track picker path with the expected initial section
  - disabled command does not call player/workflow side effects
  - `quit` keeps the current stop-current-playback behavior for active playback

Use light fakes for `Container`, `playerControl`, `workControl`, and `stateManager`; do not mount Ink for dispatcher tests.

## Verification

Run after implementation:

```sh
bun run --cwd apps/cli test:file test/unit/domain/session/command-registry-contexts.test.ts
bun run --cwd apps/cli test:file test/unit/app-shell/app-command-dispatcher.test.ts
bun run typecheck
bun run lint
bun run fmt:check
bun run test
```

## Acceptance Criteria

- Active playback palette actions and matching footer/hotkey actions execute through `dispatchAppCommand`.
- The dispatcher refuses disabled commands before side effects.
- `ink-shell.tsx` loses the large active-playback command execution switch/block.
- Existing provider picker switching continues to use the app-layer provider picker policy.
- Tests prove at least one high-risk command, `fallback`, has one execution path regardless of palette or hotkey source.

## Rollback

Because the dispatcher delegates to existing workflows, rollback should be limited to restoring previous call sites in `ink-shell.tsx` and removing the new dispatcher file/tests. No storage or provider contracts should change in this slice.
