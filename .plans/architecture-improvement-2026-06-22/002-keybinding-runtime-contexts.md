# Plan 002: Keybinding Runtime Contexts

Status: partially implemented
Priority: P0
Effort: M
Risk: Medium
Created: 2026-06-22
Depends On: `001-canonical-app-command-dispatcher.md`

## Problem

Kunai has a good keybinding registry, but production input handling still mostly bypasses it.

Current evidence:

- `apps/cli/src/app-shell/keybindings.ts` exports `KEYBINDINGS`, `bindingsForScope`, `matchBinding`, and `footerHints`.
- `apps/cli/test/unit/app-shell/keybindings.test.ts` and `keybindings-collision.test.ts` validate the registry.
- Runtime usage is not equivalent:
  - `apps/cli/src/app-shell/shell-command-input.ts` matches footer actions directly by `action.key === input.toLowerCase()`.
  - multiple surfaces call `useInput` directly.

The result is drift: the help overlay can say one thing, footers another thing, and handlers can still be bound by local component logic.

## Goal

Make `keybindings.ts` the runtime source of truth for app-owned shortcuts. Input handling should resolve named actions from active scopes, then dispatch those actions through the canonical app command dispatcher from Plan 001.

## Non-Goals

- Do not implement user `~/.config/kunai/keybindings.json` yet.
- Do not implement chord sequences yet.
- Do not replace all list navigation keys; arrow and editor keys can remain `helpOnly` or owned by lower-level controllers.
- Do not fork Ink or introduce a custom terminal parser.

## Design

Add a small runtime resolver layer:

```ts
export type ActiveKeyScope =
  | "global"
  | "browse"
  | "player"
  | "postPlayback"
  | "overlay"
  | "editing";

export type KeybindingResolution =
  | { readonly type: "matched"; readonly binding: KeyBinding }
  | { readonly type: "unmatched" }
  | { readonly type: "help-only" };

export function resolveKeybinding(
  scopes: readonly ActiveKeyScope[],
  input: string,
  key: Key,
): KeybindingResolution;
```

Rules:

- Global scope is always checked first for hard globals like Ctrl+C and `/`.
- Active surface scope is checked next.
- `helpOnly` bindings never produce runtime actions.
- Runtime binding ids should map to `AppCommandId` where possible; otherwise use a small `ShellActionId` union for app-owned non-command actions such as `back` or `command-palette`.
- Footers are derived from `footerHints(scope)` plus runtime capability filtering, not hand-built strings.

## Implementation Steps

1. Add `apps/cli/src/app-shell/input/keybinding-runtime.ts`.
2. Add an action-id mapping from keybinding ids to app commands or shell actions.
3. Update `useShellInput` so footer key matching uses `resolveKeybinding` instead of direct `footerActions.find(...)`.
4. Replace playback session key text:
   - Keep playback status chips from `formatPlaybackSessionKeysHint`.
   - Replace manual key legend construction with a `playerFooterHints(...)` helper derived from `footerHints("player")` and capability filters.
5. Migrate active playback direct letter shortcuts first:
   - `n`, `p`, `a`, `u`, `x`, `o`, `k`, `e`, `/`
   - dispatch through Plan 001 command dispatcher
6. Add TODO-free documentation around mpv-owned keys and keep them `helpOnly`.
7. Leave root overlays and browse surfaces on existing handling until player is stable, then migrate one surface at a time.

## Tests

Add or extend:

- `apps/cli/test/unit/app-shell/keybindings.test.ts`
  - `resolveKeybinding(["global", "player"], "/", {})` resolves command palette
  - `resolveKeybinding(["global", "player"], "n", {})` resolves player next when available
  - `helpOnly` entries never resolve to executable actions
- `apps/cli/test/unit/app-shell/keybindings-collision.test.ts`
  - active scope plus global scope collisions are either forbidden or explicitly allowed
- `apps/cli/test/unit/app/source-quality.test.ts`
  - playback footer includes the same player actions as `footerHints("player")`
  - unavailable next/previous commands are omitted from the visible playback legend

## Verification

Run after implementation:

```sh
bun run --cwd apps/cli test:file test/unit/app-shell/keybindings.test.ts
bun run --cwd apps/cli test:file test/unit/app-shell/keybindings-collision.test.ts
bun run --cwd apps/cli test:file test/unit/app/source-quality.test.ts
bun run typecheck
bun run lint
bun run fmt:check
bun run test
```

## Acceptance Criteria

- `matchBinding` or the new runtime resolver is used by production input code.
- The active playback footer no longer manually hardcodes every shortcut in `formatPlaybackSessionKeysHint`.
- A command shown in the player footer has the same action id used by the handler.
- Help-only bindings remain visible in help but cannot be executed accidentally.
- No new user keybinding config exists; internal truth comes first.

## Implemented Slice

- Playback session key hints moved from `apps/cli/src/app/source-quality.ts` to `apps/cli/src/app-shell/playback-session-key-hints.ts`.
- `source-quality.ts` now owns stream/source facts only; shell presentation owns key copy.
- `KeyBinding` gained optional `hintLabel` metadata for dense UI rows while help overlays keep full labels.
- `footerHints(...)` now uses `hintLabel` when present, reducing footer/help copy drift.
- `formatPlaybackSessionKeysHint(...)` derives player/source/quality/episode/command keys from `KEYBINDINGS` by action id and filters unavailable actions from playback capability state.
- `apps/cli/test/unit/app-shell/playback-session-key-hints.test.ts` proves playback hints follow keybinding registry changes.

Remaining:

- Route player hotkeys themselves through the runtime resolver and Plan 001 dispatcher.
- Migrate post-playback footer actions to the same registry + dispatcher path.
- Delete local `useInput`/footer action duplication only after matching focused tests are in place.

## Rollback

Keep the old footer formatter behavior in a small compatibility helper until the new player footer tests pass. If runtime key resolution introduces input regressions, restore `useShellInput` matching and keep the resolver isolated for another pass.
