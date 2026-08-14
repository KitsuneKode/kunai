# Shell Responsiveness, Performance, and Design Polish Pass

**Status:** Completed 2026-05-16  
**Owner:** opencode  
**Scope:** `apps/cli/src/app-shell/*`, `packages/design/src/tokens.ts`, `apps/cli/src/app-shell/layout-policy.ts`

## Goal

Make the Ink terminal UI responsive across terminal sizes, performant during long-running sessions, and visually cohesive with a premium, content-first design.

## Principles

1. **Content-first, chrome-last** — Information the user asked for should dominate; UI chrome should recede
2. **Progressive disclosure** — Show less when everything is calm, reveal more when the user needs it or when something is wrong
3. **Boundary-aware** — Every shell must adapt to terminal dimensions with explicit breakpoints and never overflow or wrap badly
4. **Performance-safe** — Long sessions (hours of browsing + playback) must not leak timers, accumulate re-renders, or retain stale closures
5. **Consistent math** — Picker layout, companion panels, and footer sizing should use shared helpers, not duplicated formulas

## Phase 1: Layout Policy Foundation

### 1.1 Per-shell minimum dimensions

Current `layout-policy.ts` uses one-size-fits-all `minColumns: 80, minRows: 20` for all shells. This is wrong:

- **Picker** with 20 items needs at least 24 rows to show 5 visible items + header + footer
- **Playback** with poster companion needs at least 92 columns and 22 rows
- **Browse** is the most forgiving: 80×20 is fine

**Changes:**

- Add per-kind minimums to `getShellViewportPolicy`
- Update `ResizeBlocker` messages to mention the specific shell's needs

### 1.2 Extract shared picker layout hook

Both `checklist-shell.tsx` and `ink-shell.tsx` (picker mode) compute `innerWidth`, `listWidth`, `companionWidth`, `rowWidth` with slightly different formulas. This causes inconsistency and bugs.

**Changes:**

- Create `usePickerLayout(columns: number, rows: number, kind: 'picker' | 'checklist')` in `layout-policy.ts`
- Returns: `{ innerWidth, listWidth, companionWidth, rowWidth, showCompanion, maxVisible }`
- Replace duplicated math in both shells

### 1.3 Tiered companion panel breakpoints

Current `wideBrowse` requires 164 columns — most terminals never hit this. Users never see the side-by-side companion.

**New breakpoints:**

- `164+` (`wideBrowse`): Full companion — poster + metadata + facts, 32-char companion column
- `132-163` (`mediumBrowse` — **new**): Compact companion — metadata + facts, **no poster**, 28-char companion
- `110-131` (`compact`): No side-by-side; companion appears below selected item with full width
- `<110` (`ultraCompact`): No companion, list only, minimal chrome

**Changes:**

- Add `mediumBrowse` to `ShellViewportPolicy`
- Update `BrowseShell` to render companion differently per tier
- Update `DiscoverShell` to use `compact` flag for rail item sizing

## Phase 2: Footer Density & Performance

### 2.1 Cap footer actions per context

Current footer shows 7+ actions. Scanning 7 items in a terminal row is cognitively heavy.

**New policy:**

- **Browse/Search**: 4 actions (`enter` search, `↑↓` navigate, `tab` switch mode, `/` commands)
- **Playback**: 5 actions (`q` stop, `n` next, `p` prev, `a` autoplay, `/` commands)
- **Picker**: 4 actions (`enter` select, `↑↓` navigate, `esc` cancel, `/` commands)
- Overflow everything else into `/` — the user already knows to hit `/` for more

**Changes:**

- Update `selectFooterActions` in `shell-primitives.tsx` to accept a `maxVisible` parameter
- Update each shell's footer action array to order by priority
- Memoize footer visible action computation with `useMemo`

### 2.2 Memoize footer computation

`ShellFooter` recomputes visible actions on every render via `selectFooterActions`. This is an O(n) loop on every keystroke.

**Changes:**

- Wrap `selectFooterActions` call in `useMemo` with `[actions, mode, terminalWidth]` deps
- Ensure `actions` arrays are stable (use `useMemo` in callers if needed)

## Phase 3: Loading Shell Progressive Disclosure

### 3.1 Time-gated information display

Current loading shell shows elapsed timer, provider detail, and diagnostics from second 0. This creates anxiety.

**New behavior:**

- **0-2s**: Dot matrix loader + stage label only (`Resolving streams…`) — calm
- **2-5s**: Add provider name + progress bar if available — user starts wondering, give context
- **5s+**: Add elapsed timer + diagnostics trace — user needs data
- **If an issue occurs**: Immediately surface the warning, regardless of elapsed time

**Changes:**

- Create `useLoadingDisclosure(elapsedSeconds, hasIssue, hasProgress)` hook in `loading-shell-runtime.ts`
- Update `LoadingShell` to conditionally render sections based on disclosure state
- Keep the dot matrix loader as the persistent visual anchor

## Phase 4: Boundary & Chrome Cleanup

### 4.1 Contextual padding

Current `ShellFrame` and `BrowseShell` both use `paddingX={1}`. This creates a visible inset frame.

**New policy:**

- **Browse, playback, discover**: `paddingX={0}` — edge-to-edge lists need every column
- **Picker overlays, command palette**: `paddingX={1}` — focused dialogs need separation

**Changes:**

- Remove `paddingX={1}` from `ShellFrame`
- Add `paddingX={1}` only to picker overlays in `ink-shell.tsx`
- Ensure `ResizeBlocker` still looks good with no padding

### 4.2 Command palette visual separation

Command palette currently floats with only `marginTop={1}` as separation. It can feel like part of the main UI.

**Changes:**

- Add a subtle top border line using `palette.borderDim` when palette is open
- Keep the palette width clamped to `columns - 4` on narrow terminals
- Make `maxVisible` dynamic: `Math.max(3, rows - 12)`

## Phase 5: Long-Running Session Performance

### 5.1 Timer consolidation

`LoadingShell` currently runs 4 independent timers:

1. `useElapsed` (1s interval)
2. `useRuntimeMemoryLine` (configurable interval)
3. `useRuntimeHealthLine` (configurable interval)
4. `usePosterPreview` debounce timer

Each creates a separate `useEffect` + `setInterval`. During state transitions, old timers may not be cleaned up immediately.

**Changes:**

- Consolidate elapsed + memory + health into a single `useEffect` with one `setInterval`
- Drive all three from the same timer tick
- Keep poster debounce separate (it's event-driven, not time-driven)

### 5.2 `useInput` handler stability

Ink's `useInput` attaches a new handler on every render if the function reference changes. This can leak stale closures.

**Changes:**

- Wrap `useInput` handlers in `useCallback` with exhaustive dependency arrays
- For handlers that close over mutable state, use a ref pattern: `const stateRef = useRef(state); stateRef.current = state;` then read from ref in handler

### 5.3 Browse shell filter throttling

`BrowseShell` re-filters on every keystroke with no throttle. On large result sets (1000+ items), this causes janky typing.

**Changes:**

- Add a 60ms throttle to filter application using `useDeferredValue` or manual `setTimeout`
- Use `useTransition` for result updates so input stays responsive

### 5.4 Poster preview preservation

`usePosterPreview` clears all rendered poster images on every URL change. When switching episodes rapidly, this causes a flash of unloaded state.

**Changes:**

- Preserve the previous poster result while loading the next one
- Only clear to `{ kind: "none" }` after a delay or on explicit reset

## Phase 6: Design Polish

### 6.1 Empty states with dot matrix loaders

Current empty states use a generic `○` icon + title + subtitle. They feel utilitarian.

**Changes:**

- Use `InlineDotMatrixLoader` or `DotMatrixLoader` for loading empty states (discover, browse initial)
- Keep error empty states calm — no animation, just a quiet message

### 6.2 Error surface quieting

`refreshError` in `DiscoverShell` takes full prominence with a dedicated Box + margin.

**Changes:**

- Render error as one line with amber color
- Dim the retry hint: `Press r to retry` in `palette.dim`
- Do not push content down — overlay or inline, not a block

### 6.3 Color token refinements

Already applied in `packages/design/src/tokens.ts`:

- Warmer backgrounds (`#110e0b`, `#1a1612`, `#241e18`)
- Desaturated amber (`#f0a050`) for premium feel
- Muted teal (`#5ad4b5`) — less neon, more calm
- Added `textDim` (`#c8bba8`) for footer labels and secondary text

## Testing Strategy

1. **Unit tests** for `layout-policy.ts` — test all breakpoint combinations
2. **Unit tests** for `usePickerLayout` — verify column math at various widths
3. **Integration tests** — resize terminal during browse, verify companion panel transitions
4. **Manual tests**:
   - 80×20 terminal: browse should work, picker should show ResizeBlocker
   - 110×30 terminal: browse should show compact mode, companion below list
   - 132×30 terminal: browse should show medium companion
   - 164×40 terminal: browse should show full companion with poster
   - Long session: leave app open for 30 minutes, verify no timer leaks via `bun run dev -- --debug`

## Files to Touch

| File                                                | Change                                                |
| --------------------------------------------------- | ----------------------------------------------------- |
| `packages/design/src/tokens.ts`                     | Color refinements (already done)                      |
| `apps/cli/src/app-shell/layout-policy.ts`           | Per-kind minimums, `mediumBrowse`, shared layout hook |
| `apps/cli/src/app-shell/use-viewport-policy.ts`     | Export new hook                                       |
| `apps/cli/src/app-shell/shell-frame.tsx`            | Remove `paddingX`, add palette border to palette      |
| `apps/cli/src/app-shell/shell-primitives.tsx`       | Memoize footer, cap actions, quiet errors             |
| `apps/cli/src/app-shell/loading-shell.tsx`          | Progressive disclosure, timer consolidation           |
| `apps/cli/src/app-shell/loading-shell-runtime.ts`   | `useLoadingDisclosure` hook                           |
| `apps/cli/src/app-shell/ink-shell.tsx`              | Tiered companion, throttle filters, stable handlers   |
| `apps/cli/src/app-shell/checklist-shell.tsx`        | Use shared picker layout hook                         |
| `apps/cli/src/app-shell/discover-shell.tsx`         | Compact rail handling, quiet errors                   |
| `apps/cli/src/app-shell/download-manager-shell.tsx` | Proportional column math                              |
| `apps/cli/src/app-shell/library-shell.tsx`          | Add viewport policy, compact mode                     |
| `apps/cli/src/app-shell/shell-command-ui.tsx`       | Dynamic maxVisible, width clamping                    |
| `apps/cli/src/app-shell/use-poster-preview.ts`      | Preserve previous poster                              |
| `apps/cli/src/app-shell/dot-matrix-loader.tsx`      | Already hardened                                      |

## Order of Implementation

1. **Layout policy foundation** (Phase 1) — everything else depends on this
2. **Shared picker layout hook** (Phase 1.2) — reduces duplicated code
3. **Footer density & memoization** (Phase 2) — immediate UX improvement
4. **Browse shell tiered companion** (Phase 1.3) — most visible change
5. **Loading shell progressive disclosure** (Phase 3) — polish
6. **Boundary & chrome cleanup** (Phase 4) — visual finishing
7. **Performance hardening** (Phase 5) — long-session safety
8. **Remaining shells** (discover, download, library, checklist) — apply shared patterns
9. **Typecheck, lint, fmt, tests** — verify everything

## Acceptance Criteria

- [ ] All shells adapt gracefully from 80 to 200+ columns
- [ ] No shell overflows or wraps badly at any breakpoint
- [ ] Footer never shows more than 5 actions
- [ ] Loading shell starts calm and reveals info progressively
- [ ] No timer leaks after 30-minute session
- [ ] Picker layout math is consistent across all picker surfaces
- [ ] ResizeBlocker shows per-shell minimums
- [ ] Typecheck, lint, and all tests pass
