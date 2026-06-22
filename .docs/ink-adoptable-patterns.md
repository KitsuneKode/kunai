# Ink / TUI patterns worth adopting

Reference survey of terminal UI patterns (comparable open-source CLIs). **Do not vendor their Ink fork or copy product-specific layers** — Kunai uses stock Ink.

## Implementation status

| Pattern                                | Status          | Kunai seam                                                                                                    |
| -------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------- |
| Modal / overlay sizing context         | **Implemented** | `overlay-layout-context.tsx`, `getOverlayContentViewport`, `getOverlayListMaxVisible`                         |
| Stable footer + transient slot         | **Implemented** | `TRANSIENT_ROW_SLOTS`, `TransientRowSlot`, `getFooterReservedRows`, `getBrowseListMaxVisible`                 |
| Notification queue semantics           | **Implemented** | `notification-queue.ts`, `ink-shell.tsx`                                                                      |
| Offscreen render freeze                | **Implemented** | `offscreen-freeze.tsx`, `loading-shell.tsx`, `getLoadingShellTimerPolicy.freezeWhenOffscreen`                 |
| Debounced status recompute             | **Implemented** | `ink-shell.tsx`, `root-status-summary.ts`                                                                     |
| Shared `LoadingState` primitive        | **Implemented** | `primitives/LoadingState.tsx`, `overlay-panel.tsx`                                                            |
| Dialog input safety (`isCancelActive`) | **Implemented** | `overlay-input-safety.ts`, `root-overlay-shell.tsx`                                                           |
| Debug error excerpt                    | **Implemented** | `error-debug-excerpt.ts`, `root-status-shells.tsx` (`--debug`)                                                |
| Overlay input routing consolidation    | **Partial**     | `input-router.ts` (`routeOverlayInput`), `use-notifications-overlay-input.ts`, `use-history-overlay-input.ts` |
| Lazy shell import                      | **Implemented** | `main.ts`                                                                                                     |

## High ROI (layout + UX discipline)

### 1. Modal / overlay sizing context — **Implemented**

**Problem:** Pickers size against full `stdout.rows` instead of the overlay pane, so lists show too many or too few rows.

**Adopt:** Pass `{ contentRows, contentColumns }` from `root-overlay-shell.tsx` into `overlay-panel.tsx` and `layout-policy.ts` (like a `ModalContext`).

**Kunai files:** `overlay-layout-context.tsx`, `root-overlay-shell.tsx`, `overlay-panel.tsx`, `layout-policy.ts`

### 2. Stable footer height — **Implemented**

**Problem:** Status/toast lines appearing async steal a row and jump the browse list.

**Adopt:** Reserve fixed footer rows in `ShellFooter` (`shell-primitives.tsx`) — blank placeholder while loading; always reserve one transient row under `AppHeader`.

**Kunai files:** `shell-primitives.tsx` (`TransientRowSlot`, `getFooterReservedRows`), `ink-shell.tsx`, `layout-policy.ts`

### 3. Notification queue semantics — **Implemented**

**Problem:** Multiple sources (downloads, provider failures, queue recovery) flicker or overwrite toasts.

**Adopt:** Small queue: priority, `dedupKey` fold, single active toast, timeout — keep `notification-toast.ts` string-only.

**Kunai files:** `notification-queue.ts`, `notifications-shell.tsx`, `ink-shell.tsx`

### 4. Offscreen render freeze — **Implemented**

**Problem:** Spinners in scrollback force full redraws.

**Adopt:** Cache last rendered output for off-viewport animated blocks (`DotMatrixLoader`, stage rails).

**Kunai files:** `offscreen-freeze.tsx`, `dot-matrix-loader.tsx`, `loading-shell.tsx`, `loading-shell-runtime.ts`

## Medium ROI

### 5. Debounced status recompute — **Implemented**

Refs + narrow re-render trigger + debounce for `buildRootStatusSummary` / playback telemetry (`ink-shell.tsx`).

### 6. Shared `LoadingState` primitive — **Implemented**

Spinner + title + subtitle; `OverlayPanel` skips duplicate chrome when already framed by overlay host.

### 7. Debug error excerpt — **Implemented**

Dev-only second pane in `ErrorShell` with top stack frame (`--debug` / `debugTracePath`), using captured `Error` objects only — no sync `readFileSync` in hot paths.

### 7b. Dialog input safety — **Implemented**

`isOverlayCancelActive` defers overlay Esc while settings/provider text fields are being edited; dirty settings require double Ctrl+C to discard.

### 8. Lazy shell import — **Implemented**

Dynamic import heavy shell after SQLite/config bootstrap (cold start).

### 9. Overlay input routing — **Partial**

`routeOverlayInput` for shared overlay chords; per-overlay key maps extracted to `use-notifications-overlay-input.ts` and `use-history-overlay-input.ts`.

## Do not port

| Item                                         | Why                                                      |
| -------------------------------------------- | -------------------------------------------------------- |
| Vendored Ink fork (`ScrollBox`, custom Yoga) | Maintenance cost; use list windowing in `MediaListShell` |
| REPL monolith / permission / MCP UI          | Domain-specific                                          |
| Telemetry / feature-flag hooks everywhere    | Product noise                                            |
| React Compiler output style                  | Not hand-written target                                  |

## Already strong in Kunai

- Command palette (`shell-command-ui.tsx`, `shell-command-model.ts`)
- Viewport policy (`layout-policy.ts`)
- Overlay model (`root-overlay-model.ts`, `overlay-panel.tsx`)
- Loading stages (`loading-shell.tsx`, `loading-shell-runtime.ts`)
- Input routing (`input-router.ts`, `keybinding-runtime.ts`)

See also: `.docs/ux-architecture.md`, `.docs/design-system.md`
