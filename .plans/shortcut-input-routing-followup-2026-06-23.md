# Shortcut Input Routing Follow-up

Generated: 2026-06-23

## Current Finding

We fixed one confirmed first-key-loss bug in commit `9f53489d`:

- `useShellInput` kept `commandMode=true` when its caller set `disabled=true`.
- `ShellFrame` could therefore hide/lock the command palette while the hook still treated it as open.
- After the overlay/input lock cleared, the next shortcut (`o`, `r`, etc.) could be consumed by hidden command-mode handling instead of reaching the footer action or post-play fallback.
- Regression coverage: `apps/cli/test/unit/app-shell/shell-command-input.useinput.test.tsx`.

This matches the reported symptom where shortcuts sometimes work only after opening/closing the command palette.

## Calendar Focus-Zone Root Cause (fixed)

The `commandMode` bug above explains the playback/post-play shortcuts, but it does
NOT explain the `/calendar` up/down/left/right flakiness. That has a separate,
structural root cause in `apps/cli/src/app-shell/browse-shell.tsx`.

Root cause — the calendar runs in a focus zone built for a screen that has a
search box, but calendar has none:

- `BrowseShell` models keyboard ownership with focus zones: `query` (text input)
  → `list` (bare hotkeys) → `filter` → `idle`. Arrow navigation (`↑`/`↓`) is
  gated behind `isBrowseListFocused(focusZone)`.
- The shell boots in `query` focus by default. On a normal search screen this is
  fine because the visible `InputField` owns the cursor. But the calendar view
  renders NO `InputField`, so `query` is an invisible dead zone.
- Consequence (the "first key does nothing" / "blocked" feel): the first `↑`/`↓`
  only runs the `!listFocused` branch, which dispatches a focus-zone change
  (`query → list`) and returns WITHOUT moving the selection. Only the second key
  press actually navigates. Intermittency came from the zone sometimes already
  being `list` (e.g. after a prior interaction) and sometimes not.
- It re-armed itself: `Esc` and opening a details overlay both reset focus to
  `query` (`dispatchFocusZone escape` / `setFocusZone("query")`), so after closing
  details or pressing Esc once, the very next arrow was dead again.
- Left/right felt broken for a related-but-different reason: calendar `←`/`→` are
  NOT focus-gated, so they were actually firing, but the surrounding ghost-focus
  confusion plus per-selection render lag (poster/companion refresh) made them
  feel unreliable. The render lag was already mitigated by memoizing
  `buildCalendarRenderRows`; the remaining "nothing happened" cases are clamping
  at the first/last day, an open command palette, or an open overlay.

Fix (implemented in `browse-shell.tsx`):

- Boot the calendar straight into `list` focus. The `useState` initializer detects
  a calendar boot from `initialResults`/`initialResultSubtitle` and returns `list`
  instead of `query`.
- Keep it in `list` while the schedule has rows via a focus effect: when
  `isCalendarView && displayOptions.length > 0 && !listFocused`, force
  `setFocusZone("list")`. This also repairs focus after a details overlay closes
  (overlay open sets `query`; the effect pulls it back to `list`).
- Make calendar `Esc` self-contained so it never routes into the ghost `query`
  zone (which the focus effect would instantly undo, making Esc appear dead):
  on calendar, Esc clears an active day filter first, otherwise `clearResults()`
  backs out of the schedule entirely.

Net effect: on `/calendar`, the FIRST `↑`/`↓`/`←`/`→` acts immediately, and the
behavior is stable across details open/close and Esc.

## Calendar Rapid-Navigation Stall (fixed)

Even after the focus-zone fix, holding/repeating `↑`/`↓` on `/calendar` still felt
like a background process was blocking the thread, and on the "All" aggregated tab
the highlight appeared not to move. History/search do not show this.

Root cause — heavy per-item preview work fired on EVERY intermediate selection:

- Each `setSelectedIndex` re-renders `BrowseShell`, which changes `selectedOption`.
- Two effects keyed on `selectedOption` then ran on every keystroke:
  - the poster pipeline (`usePosterPreview` → `fetchPoster`): a network image
    fetch plus a chafa/kitty render subprocess per poster (the "background
    process"), and
  - the companion details effect (`buildDetailsPanelDataFromBrowseOption` +
    `resolveBrowseDetailsSecondary`, with a `setCompanionDetails` each).
- `usePosterPreview`'s reducer also returned a NEW object for every `"loading"`
  dispatch, forcing an extra render per keystroke.
- Calendar is uniquely exposed: the "All" tab aggregates the entire schedule
  (hundreds of rows) and EVERY row carries a poster, so the render/stdout flood
  per keypress was large enough to drop inputs — the highlight looked stuck.
  Search lists are short and often have no poster; history is a separate, lighter
  shell, so neither exhibits it.

Fix (in `browse-shell.tsx` + `use-poster-preview.ts`):

- Added a debounced `settledOption` (80ms). The highlight (`boundedSelectedIndex`)
  still moves on every keystroke (cheap), but the preview surface — poster fetch,
  companion details, and the preview rail — now reads `settledOption`, so the
  heavy work only fires once navigation settles. `selectedOption` stays live for
  input handlers (Enter / details / follow / queue).
- `settledOption` is seeded to the initial selection, so first paint is unchanged.
- Lowered the poster hook's own `debounceMs` to 16 (no longer double-debouncing on
  top of `settledOption`).
- `usePosterPreview` reducer now returns the same reference when already loading,
  so repeated `"loading"` dispatches no longer force re-renders during a hold.

Net effect: rapid `↑`/`↓` on `/calendar` (including the "All" tab) is one cheap
render per keystroke; the poster/side panel catch up when you pause.

## Calendar Per-Keystroke Latency — "registers late" (fixed)

After the debounce, navigation still felt like every keystroke registered late
("game lag in a crowded lobby"). Tracing where work actually happens on the
keypress path surfaced three more costs, in impact order:

1. Preview pane force-REMOUNT every keystroke (biggest). The companion `<Box>`
   used a selection-derived React key:
   `browse-companion-${boundedSelectedIndex}-${selectedOption.label}`. Every ↑/↓
   changed the key, so React unmounted and remounted the entire preview subtree
   (PreviewRail + poster + DetailsSheet) synchronously on the keypress path —
   running cleanup + fresh effects + re-emitting the poster block every time,
   instead of a cheap reconcile. Fix: stable `key="browse-companion"`.

2. Poster pipeline saturating the event loop. `fetchPoster` does a network image
   download plus a chafa/Kitty SUBPROCESS spawn. On a single-threaded runtime,
   that I/O competes with the stdin `readable` handler, so keypresses queue behind
   it and "register late". Stepping made it worse because the poster cache was
   tiny (`MAX_CACHE = 12`), so a screen of scrolling thrashed it and re-spawned
   chafa for rows just visited. Fixes: (a) raise the settle window to 150ms so a
   run of presses spawns NOTHING until navigation rests; (b) raise `MAX_CACHE` to
   64 so revisits hit the cache.

3. Heavy poster block re-emitted into every frame. A `kind:"text"` (chafa) poster
   is a large ANSI color block rendered as Ink text. Because the companion shares
   output lines with the shifting list, Ink rewrites the whole block on every
   frame. Fix: while navigating (`selectedOption !== settledOption`) render the
   light placeholder tile instead of the poster; draw the real poster only once
   navigation settles.

What is NOT the cause (verified): the expensive pure builders are correctly
memoized and do NOT run per keystroke — `displayOptions`, `calendarRenderRows`
(O(n log n) sort), and `useCalendarState.days` all have selection-independent
deps; `CalendarScheduleRow` is `React.memo` with stable per-option keys.

Order of fixes applied: (1) stable companion key → (2) 150ms settle gate +
navigating poster suppression → (3) larger poster cache. (1) removes the
per-keystroke remount; (2) frees the event loop during stepping; (3) avoids
re-spawning chafa on revisit.

### Hardening pass (follow-up plan)

- Instrumentation: `apps/cli/src/app-shell/diagnostics/render-trace.ts` (debug-gated
  via the existing `dbg` logger) records per-surface renders, renders-per-keystroke
  fan-out, idle (background-timer) renders, and poster fetch / cache-hit / subprocess-
  spawn counts. Wired into `browse-shell` (render body + `useInput`) and `fetchPoster`
  in `image-pane.ts`. Read with `bun run dev -- --debug 2> debug.log`.
- Settle window extracted to `PREVIEW_SETTLE_MS` in `apps/cli/src/app-shell/hooks/use-settled-value.ts`
  behind a reusable `useSettledValue` hook (replaces the inline `setTimeout` in browse-shell).
- Poster suppression refined to `kind:"text"` only: the heavy chafa block is hidden
  while navigating, but Kitty posters (drawn out-of-band, tiny placeholder) are left
  in place so suppression cannot orphan an on-screen image. The stable companion key
  does NOT reintroduce ghosting: `usePosterPreview` clears terminal images on each new
  fetch, independent of mount lifecycle.
- Poster slot height reserved via `PreviewRail reserveRows` (= `PREVIEW_POSTER_ROWS`),
  so the placeholder → image swap on settle no longer reflows the side panel.

### Background-timer idle-commit audit (no throttling needed)

`AppRoot` ([ink-shell.tsx](apps/cli/src/app-shell/ink-shell.tsx)) is now traced too
(`recordRender("ink-shell")`), so `--debug` reports any idle full-frame commit while
parked on /calendar. Static audit of its periodic timers shows none force an idle
commit there:

- 1s telemetry `refreshSnapshot` is gated by `playbackIsActive`, so its interval is
  never even created on /calendar.
- 2s `resolveStatus` calls `setDownloadStatus(string)`; React bails when the string
  is unchanged (idle queue → identical summary → no commit).
- 60s `refresh` calls `setStreak(number)`, `setSyncHealth(string-union)`,
  `setPlaylistCount(number)` — all primitives that bail when unchanged.
- `rootStatusSummary` rebuild is gated behind a changed-input `useMemo` and a
  `ROOT_STATUS_DEBOUNCE_MS` debounce, so it only fires on a real input change.

Conclusion: idle commits on /calendar are effectively nil; throttling/coalescing was
deliberately NOT added (it would risk delaying genuine status updates for no measured
benefit). The tracer remains so this can be re-confirmed on any terminal.

### Anti-churn pattern extended to other navigable poster surfaces

The settled-selection + text-poster-suppression pattern is now shared via
`apps/cli/src/app-shell/hooks/use-rail-poster.ts` (`useRailPoster`, built on
`useSettledValue` + `usePosterPreview`) and applied where lists are navigable and
carry a large poster:

- ListShell picker ([ink-shell.tsx](apps/cli/src/app-shell/ink-shell.tsx)): poster on
  settled selection, heavy block suppressed while navigating, label/detail stay live.
- Episode picker ([overlay-panel.tsx](apps/cli/src/app-shell/overlay-panel.tsx)): poster
  on settled selection url; rail already reserves `height={6}` and is `React.memo`.
- History + queue rails ([history-shell.tsx](apps/cli/src/app-shell/history-shell.tsx),
  [queue-shell.tsx](apps/cli/src/app-shell/queue-shell.tsx)) via `useRailPoster`.

Audited and intentionally left unchanged:

- `MediaListShell` is `React.memo` with a stable (non-selection) key and now feeds
  `PreviewRail reserveRows`, so no remount churn.
- `MiniPosterTile` is tiny (2×4), selection-gated (`enabled`), 160ms debounced — its
  re-emission cost is negligible.
- Post-play rail artwork is fixed per screen (next-up hero), not navigable per
  keystroke, and its slot is height-reserved; library shell renders no posters.

### Input-routing hardening (Recommended Next Order — done)

1. Input-drop instrumentation: `recordInputDrop(surface, reason, key)` in
   [render-trace.ts](apps/cli/src/app-shell/diagnostics/render-trace.ts), wired into
   `useShellInput` for the unambiguous drops — `input-locked` (disabled), `binding-disabled`
   (key bound but disabled), `handled-externally` (`letterKeysHandledExternally`).
   Frame-level `no-binding` is deliberately NOT logged because sibling surface `useInput`
   handlers commonly own those keys, so it would mislead.
2. Post-play overlay gate collapsed: `ShellFrame` already suppresses `onUnhandledInput`
   while `inputLocked` (proven by
   [shell-frame-input-bridge.test.tsx](apps/cli/test/unit/app-shell/shell-frame-input-bridge.test.tsx)),
   so the redundant `if (overlayBlocksInput) return` in `PlaybackShell` was removed. The
   resolver keeps `blockedByOverlay` as a tested pure-function guard.
3. Root-overlay left/right delivery is locked by
   [tracks-panel-input-bridge.test.tsx](apps/cli/test/unit/app-shell/tracks-panel-input-bridge.test.tsx):
   →/← reach `tracksPanelNavReducer` through real input, and arrows are withheld while the
   palette is open (catching the stale-command-mode regression class).
4. `letterKeysHandledExternally` audit: the only surface is `LoadingShell`, which pairs it
   with its own `commandModeOpen`-gated `useInput` (letters resolved via the pure
   `resolvePlaybackShellInput`). Bridge test 3 proves ShellFrame suppresses the footer-letter
   resolution and delivers the key, so the local handler owns it on first press; no change
   needed. (Harness note: lone `Esc` is not delivered as `key.escape` by Ink's parser in the
   capture harness; multi-byte sequences like arrows and `/` work, so palette-close-then-arrow
   is asserted via the disabled-reset/`useShellInput` unit path rather than a lone Esc.)

### Verification results (Phase 6)

Gates (repo root): `bun run typecheck` ✅, `bun run lint` ✅ (CLI 0/0; 2 pre-existing
`@kunai/providers` test warnings, unrelated), `bun run test` ✅ **2098 pass / 7 skip / 0 fail**
across 392 files, `bun run build` ✅ (dist 2.4 MiB).

Deterministic test-derived numbers (the chafa/Kitty subprocess cost is not reproducible in
CI — no image renderer — so these assert the render fan-out the latency fix targets, via real
input delivery + committed frames in the capture harness):

| Behavior                                         | Before (pre-fix shape)                                  | After (asserted by test)                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Frames committed per key during a held ↑/↓ burst | highlight commit **+ poster/companion churn** every key | **exactly 1** committed frame per key ([settle-value.test.tsx](apps/cli/test/unit/app-shell/settle-value.test.tsx))            |
| Settled preview commits during an N-key burst    | up to N (one per key)                                   | **0** during burst, **1** after settle (N=5 → N+1 total)                                                                       |
| `usePosterPreview` repeat-`loading` dispatch     | new object → extra commit per key                       | **same state reference** → React bails ([use-poster-preview.test.ts](apps/cli/test/unit/app-shell/use-poster-preview.test.ts)) |
| `useSettledValue` during burst                   | n/a                                                     | live tracks every key; settled stays at seed, then jumps straight to latest (not each intermediate)                            |

Real-terminal numbers: the `--debug` instrumentation
([render-trace.ts](apps/cli/src/app-shell/diagnostics/render-trace.ts)) is in place — run
`bun run dev -- --debug 2> debug.log` on a chafa/Kitty terminal and grep
`"module":"render-trace"` for `rendersForPrevKey`, poster `spawns`, and `idle render` counts
while holding ↑/↓ on `/calendar`. Acceptance: ~1 render/key, 0 poster spawns until the
navigation rests, cache hits on revisit.

### Left/right day-step clamp (intentional, documented)

In calendar view, ←/→ call `stepDay` ([use-calendar-state.ts](apps/cli/src/app-shell/hooks/use-calendar-state.ts)):
from "all days" it enters at today (or the first day, never the furthest-future
day); at either end of the strip it returns the current key, i.e. a deliberate
no-op rather than wrapping. So an unresponsive-feeling ←/→ at a strip edge is
expected behavior, not a dropped key.

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
- First `↑`/`↓` on `/calendar` moves the selection (no dead first press), including immediately after entering the schedule.
- First `↑`/`↓` after closing a calendar details overlay still navigates (focus is not stranded in `query`).
- Calendar Esc clears an active day filter first, then backs out of the schedule; it never lands in an invisible `query` zone where Esc appears to do nothing.
- Holding `↑`/`↓` on `/calendar` "All" tab moves the highlight every press without stalling; poster/side panel update after navigation settles, not per keystroke.

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
