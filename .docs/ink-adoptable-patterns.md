# Ink / TUI patterns worth adopting

Reference survey of terminal UI patterns (comparable open-source CLIs). **Do not vendor their Ink fork or copy product-specific layers** — Kunai uses stock Ink.

## High ROI (layout + UX discipline)

### 1. Modal / overlay sizing context

**Problem:** Pickers size against full `stdout.rows` instead of the overlay pane, so lists show too many or too few rows.

**Adopt:** Pass `{ contentRows, contentColumns }` from `root-overlay-shell.tsx` into `overlay-panel.tsx` and `layout-policy.ts` (like a `ModalContext`).

**Kunai files:** `root-overlay-shell.tsx`, `overlay-panel.tsx`, `use-viewport-policy.ts`

### 2. Stable footer height

**Problem:** Status/toast lines appearing async steal a row and jump the browse list.

**Adopt:** Reserve fixed footer rows in `ShellFooter` (`shell-primitives.tsx`) — blank placeholder while loading.

**Kunai files:** `shell-primitives.tsx`, `root-status-summary.ts`, `loading-shell.tsx`

### 3. Notification queue semantics

**Problem:** Multiple sources (downloads, provider failures, queue recovery) flicker or overwrite toasts.

**Adopt:** Small queue: priority, `dedupKey` fold, single active toast, timeout — keep `notification-toast.ts` string-only.

**Kunai files:** `notification-toast.ts`, `notifications-shell.tsx`

### 4. Offscreen render freeze (optional)

**Problem:** Spinners in scrollback force full redraws.

**Adopt:** Cache last rendered output for off-viewport animated blocks (`DotMatrixLoader`, stage rails).

**Kunai files:** `dot-matrix-loader.tsx`, `loading-shell.tsx`

## Medium ROI

### 5. Debounced status recompute

Refs + narrow re-render trigger + debounce for `buildRootStatusSummary` / playback telemetry (`ink-shell.tsx`).

### 6. Shared `LoadingState` primitive

Spinner + title + subtitle; `OverlayPanel` skips duplicate chrome when already framed by overlay host.

### 7. Debug error excerpt

Dev-only second pane in `ErrorShell` with top stack frame (`--debug`), no sync `readFileSync` in hot paths.

### 8. Lazy shell import

Dynamic import heavy shell after SQLite/config bootstrap (cold start).

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
