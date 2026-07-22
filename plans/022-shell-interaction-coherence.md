# 022 — Shell interaction coherence: help, destructive actions, filters, errors

- **Written against commit**: `01ab215b`
- **Priority**: P2
- **Effort**: L (five independent slices)
- **Risk**: LOW–MED (Esc/back semantics are load-bearing; see 022.5)
- **Depends on**: nothing

## Why this matters

`apps/cli/src/app-shell/keybindings.ts:6-18` opens by asserting:

> what is documented can never drift from the keys that are actually bound

That is false in several ways, and the shell's input layer is the least coherent part
of an otherwise careful product. Each slice below is independently shippable.

---

## 022.1 — `?` shows the wrong surface's help (S, highest value)

`apps/cli/src/app-shell/root-shell-state.ts:133-148` — `resolveHelpScope` switches
only on `state.playbackStatus` and can return exactly three values: `"player"`,
`"postPlayback"`, `"browse"`.

So pressing `?` inside Up Next, History, Notifications, Library or Downloads shows
**browse** help. `keybindings.ts:607-910` defines **28 bindings** across those five
scopes whose help copy is therefore unreachable — `J/K` reorder, `g/G` jump to ends,
`[`/`]` paging, `p` protect. `HELP_SCOPE_LABELS` (`root-overlay-shell.tsx:163-175`)
even carries labels for scopes `resolveHelpScope` can never produce.

**Fix.** Derive the scope from the top overlay (`state.activeModals.at(-1)`) before
falling back to playback status: `queue`→`queue`, `history`→`history`,
`notifications`→`notifications`, `library`/`downloads`→`library`, pickers→`browse`.
Add `downloads` and `stats` to `KeyScope` while there.

**Verify.** Test `resolveHelpScope` per overlay type. Then extend
`contract-conformance.test.ts`: every `KeyScope` must be reachable from
`resolveHelpScope` — that turns this class of bug into a build failure.

---

## 022.2 — One confirmation policy for destructive actions (M)

Four different policies coexist today, and the two most destructive operations have
**no guard at all**:

| Action                           | Site                                     | Guard           |
| -------------------------------- | ---------------------------------------- | --------------- |
| Clear entire queue (`c`)         | `root-overlay-shell.tsx:1453`            | none            |
| Remove queue entry (`x`)         | `root-overlay-shell.tsx:1440`            | none            |
| Delete notification (`d`)        | `use-notifications-overlay-input.ts:129` | none            |
| Clear all archived (`C`)         | `use-notifications-overlay-input.ts:136` | none            |
| Abort **running** download (`x`) | `download-manager-shell.tsx:266`         | none            |
| Delete non-running download      | `download-manager-shell.tsx:271`         | double-press    |
| Delete library title (`x`)       | `library-shell.tsx:305`                  | double-press    |
| Clear history                    | `shell-workflows.ts:1262`                | real Yes/Cancel |

Wiping the queue and killing an in-flight multi-GB download are the two least
recoverable actions in the shell — and `c` sits one modifier from the global `Ctrl+C`
quit.

**Fix.** Extract the `confirmingDeleteIndex` arm/confirm pattern from
`download-manager-shell.tsx` into a shared `useArmedAction` hook. Apply to queue
`c`/`C`/`x`, notifications `d`/`C`, and download-abort. Render the armed banner
through the existing `StateBlock`/`ContextStrip` so the copy is identical everywhere.

Keep the second keypress as the confirm so the deliberate case stays one key — do not
introduce a modal for these.

---

## 022.3 — Stop action keys eating characters out of filter fields (M)

`apps/cli/src/app-shell/library-shell.tsx:277-291` accepts any printable character
**except** `x`, `X`, `p`, `P`, hard-excluded so the delete/protect chords win. So you
cannot filter your offline library for "Spy x Family" or "Pluto". The episode picker
does the same with `m` and `s` (`root-overlay-shell.tsx:1642-1697`), so "Summer" and
"Movie" are unfilterable there.

The character vanishes with no feedback — it reads as a dropped keystroke, not a
shortcut. It also contradicts `.docs/keybindings.md:139-146` ("Type — Filter rows").

**Fix.** Adopt the browse shell's focus-zone model (`browse-focus-zone.ts`) wherever a
surface has both a filter and row actions: printable keys always type while the filter
owns focus; action chords fire only once the list owns focus.

---

## 022.4 — Give async surfaces real error states and stop swallowing rejections (M)

Only four surfaces have loading + empty + error: history, library, browse, calendar.
The rest are empty-only — `queue-view.ts:24` and `stats-view.ts:108` are literally
`state: "empty" | "success"`; also `notifications-shell.tsx:111`,
`download-manager-shell.tsx:436`, `tracks-panel-shell.tsx:123`.

Three async paths have **no rejection handler at all**:

- `ink-shell.tsx:1609` — `void statsService.fetchGenreBreakdown(...).then(...)`, no
  `.catch`. Genre chart silently stays stale forever on failure.
- `ink-shell.tsx:1673` — Stats `e` export runs `mkdir`/`Bun.write` inside a bare
  `void (async () => {...})()`. A read-only data dir produces _nothing_ — no error,
  just an unhandled rejection under the Ink render.
- `SettingsShell.tsx:110,130` — `void persistSettingsDraft(...)`, no `.catch`. **The
  user believes their settings saved.**

**Fix.** Widen those view-model unions to
`"loading" | "empty" | "error" | "success"`, render the existing `StateBlock` error
variant, and attach `.catch` handlers that feed the error state instead of dropping.

**Related, same pass:** the calendar error state renders an action row
`{ label: "Refresh schedule", shortcut: "r" }` (`calendar-ui.model.ts:525-534`) and
**`r` has no handler on that surface** — `rg -n 'retry-calendar' apps/cli/src` returns
no consumer. Either bind it or drop the row. An error state advertising a recovery
path it does not implement is worse than one with no actions.

Also: most mutations are silent. Up Next `J K g G x c C` all mutate and return with no
status; notifications `A`/`r`/archive are silent while `d` sets one — the same surface
is inconsistent with itself. `browse-shell.tsx:807` already has
`runMutationWithFeedback`; lift it out and reuse it.

---

## 022.5 — Esc/back-stack asymmetries (M, MED risk)

`overlay-back-stack.ts:26-34` defines the canonical order: clear filter → exit pane →
cancel confirmation → defer to surface → cancel picker → close.

Library and Downloads opt out via `surfaceOwnsEscape` (`root-overlay-shell.tsx:1313`),
and `library-shell.tsx:259-267` only unwinds `confirmDeleteKey` before `onClose()` —
never clearing `filterQuery`. So Esc in a filtered library closes the whole overlay and
drops the filter, while every other overlay clears the filter first.

Separately, `overlay-input-safety.ts:8-20` special-cases **only** `provider_picker` for
a non-empty filter, so `?` types a literal `?` into the provider filter but opens help
when typed into an episode/season/subtitle filter — while `.docs/keybindings.md:17-18`
states the provider-picker behavior is the intended rule everywhere.

**Fix.** Have Library/Downloads report filter state into `resolveOverlayBackStack`
instead of setting `surfaceOwnsEscape`, and generalize `isOverlayCancelActive`'s
provider-picker branch to "any picker with a non-empty filter".

**Extend the existing `overlay-back-stack` tests first** — Esc semantics are
load-bearing and this is the slice most likely to cause regressions.

---

## Also worth folding in (small, no separate slice needed)

- **Dead input plumbing.** `input-router.ts:30-33` declares
  `Extract<KeyScope, "browse" | "loading" | "player" | "post-playback">` — but
  `KeyScope` spells it `"postPlayback"` (`keybindings.ts:29`), so `Extract` silently
  resolves that member to `never` and post-playback can never be passed. The function
  it guards, `resolveSurfaceTitleControlInput`, has **no production callers**. A
  compiler-silent bug: `tsc` reports success. Fix the literal, then either wire the
  function up or delete it with its tests.
- **`footerHints()` has no production caller** (`keybindings.ts:1098`) despite the
  module docblock naming it as the footer's reader. Meanwhile `stats-view.ts:482`
  hardcodes its footer as a string listing six keys that exist in no scope — there is
  no `stats` scope at all. Delete `footerHints()` or make the footers use it.
- **Stats has no viewport gate.** `ink-shell.tsx:2027-2041` mounts `StatsShell` with no
  `ViewportResizeGate`, unlike every other panel. Below ~36 columns the
  `Math.max(30, cols - 6)` floor (`:1591`) exceeds the terminal and the heatmap
  overflows. Its `useInput` also ignores `/` and `?`, the two universal keys.
- **`/skip` is misnamed** — `command-registry.ts:473` aliases it to _toggle-autoskip_,
  not "skip this segment" (which is `b`). Mid-playback that is roughly the opposite of
  what a viewer expects.

## Done criteria

```sh
bun run typecheck && bun run lint && bun run test
```

Per slice, plus:

- 022.1: a test mapping each overlay type to its help scope.
- 022.2: a test that each destructive action requires two presses.
- 022.3: a test that typing `x` into the library filter filters rather than deletes.
- 022.4: a test that a rejected settings persist surfaces an error state.
- 022.5: extended `overlay-back-stack` coverage before any behavior change.

## Maintenance note

The root cause of most of this is that the keybinding registry describes roughly half
the shell: only three sites consult it (`browse-shell.tsx:1301,1309`,
`playback-shell-input.ts:117`, `post-play-view.ts:795`) while
`use-notifications-overlay-input.ts`, all of Up Next, `library-shell.tsx`,
`download-manager-shell.tsx`, `settings/controller.ts` and Stats hand-roll string
comparison. Consider an architecture test that fails when a surface file contains a
bare `input === "<letter>"` comparison — that is the ratchet which keeps 022 from
recurring.
