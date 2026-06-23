# Shortcut Input Routing Follow-up

Generated: 2026-06-23

## Current Finding

We fixed one confirmed first-key-loss bug in commit `9f53489d`:

- `useShellInput` kept `commandMode=true` when its caller set `disabled=true`.
- `ShellFrame` could therefore hide/lock the command palette while the hook still treated it as open.
- After the overlay/input lock cleared, the next shortcut (`o`, `r`, etc.) could be consumed by hidden command-mode handling instead of reaching the footer action or post-play fallback.
- Regression coverage: `apps/cli/test/unit/app-shell/shell-command-input.useinput.test.tsx`.

This matches the reported symptom where shortcuts sometimes work only after opening/closing the command palette.

## Still Suspicious

The broader input system still has multiple owners and duplicate gates:

- `ShellFrame` owns global hard quit, command palette, footer shortcuts, and fallback `onUnhandledInput`.
- Post-play passes `inputLocked={overlayBlocksInput}` and also checks `if (overlayBlocksInput) return` before calling `resolvePostPlayUnhandledInput`.
- `resolvePostPlayUnhandledInput` has a third `blockedByOverlay` gate.
- Root overlays call `useShellInput` and also have local `useInput` branches for overlay-specific keys.
- Left/right is handled locally in several surfaces:
  - tracks panel: `apps/cli/src/app-shell/root-overlay-shell.tsx`
  - stats shell: `apps/cli/src/app-shell/ink-shell.tsx`
  - calendar browse: `apps/cli/src/app-shell/browse-shell.tsx`

These are not all wrong, but they make "why was this key ignored?" hard to answer.

## Recommended Next Order

1. Add input-drop reason instrumentation.
   - Introduce a tiny debug-only hook or event helper for dropped keys.
   - Record one reason: `input-locked`, `command-mode`, `overlay-blocked`, `no-binding`, `binding-disabled`, `handled`.
   - Keep it off by default or behind existing debug logging.

2. Collapse duplicate post-play overlay gates.
   - Let `ShellFrame inputLocked` be the primary overlay lock for command palette/footer/fallback delivery.
   - Keep `resolvePostPlayUnhandledInput(...blockedByOverlay...)` only as a pure-function guard for direct callers/tests, or remove the runtime duplicate if tests prove `ShellFrame` fully owns it.
   - Add bridge tests for first `o`, first `r`, first `h`, and Enter after an overlay closes.

3. Add root-overlay left/right transition tests.
   - Test tracks panel first: right enters options, left exits options, Esc closes/exits as expected.
   - Include a command-palette-open/close or overlay replacement transition before the first arrow key.
   - This verifies the fixed `useShellInput` state does not leave root overlays in a stale command-mode branch.

4. Audit `letterKeysHandledExternally`.
   - `LoadingShell` and playback surfaces use this to let local handlers own letters while `/` still opens commands.
   - Confirm every surface with `letterKeysHandledExternally` has tests proving direct keybindings still fire on first press.

5. Only after the above, consider a central input-router model.
   - Do not move everything into one giant router yet.
   - First create small pure resolvers per surface: `postPlayInput`, `tracksPanelInput`, `calendarInput`.
   - Then make the render hooks thin adapters over those resolvers.

## Acceptance Checks

- First `o` after closing a palette/overlay opens source selection.
- First `r` after closing a palette/overlay replays/retries where that action is available.
- First left/right in tracks panel switches panes without requiring a prior palette interaction.
- Esc on history/filterable overlays keeps the intended double-Esc contract: first clears a non-empty filter, second closes.
- No hidden command palette state is rendered or active while `inputLocked=true`.

## Regression Surface

- Command palette autocomplete and Esc behavior.
- Post-play footer actions versus direct fallback resolver.
- Root overlay local key loops for tracks, history, queue, notifications, and settings.
- Browse calendar left/right navigation.
- Loading/playback surfaces using `letterKeysHandledExternally`.

## Suggested Test Files

- `apps/cli/test/unit/app-shell/shell-command-input.useinput.test.tsx`
- `apps/cli/test/unit/app-shell/post-play-h.useinput.test.tsx`
- `apps/cli/test/unit/app-shell/root-overlay-bridge.test.ts`
- Add a focused `tracks-panel-input` or root overlay bridge test before changing tracks panel behavior.
