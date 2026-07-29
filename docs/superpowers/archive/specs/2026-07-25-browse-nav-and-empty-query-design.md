# Browse navigation ring and empty-query behaviour

Status: approved 2026-07-25

## Problem

Two UX defects in the browse/search surface.

### 1. Emptying the query refetches and steals focus

`browse-shell.tsx` eagerly reacts the moment the draft hits zero characters:

```ts
if (normalized.value.trim().length === 0 && lastSearchedQuery.trim().length > 0) {
  if (onLoadDiscovery && reloadDiscoveryRef.current) reloadDiscoveryRef.current();
  else clearResults();
}
```

Backspacing to retype therefore fires a discovery reload — a real network
call — as a side effect of typing. Focus is yanked at the same time from two
directions: `runSearch` calls `setFocusZone("query")`, and the list briefly
empties during the swap, tripping the `results-became-empty` guard that
force-returns focus to the query zone.

### 2. The navigation ring is asymmetric, and the first row is unreachable

Current arrow behaviour:

- `↑` from the input enters the list **and jumps to the last row**
  (`setSelectedIndex(displayOptions.length - 1)`)
- `↓` from the input enters the list but **inherits the stale `selectedIndex`**
- `↓` on the last row returns to the input
- `↑` on row 0 returns to the input

`↑`-from-input has a deliberate "jump to last" rule; `↓`-from-input has no
matching "jump to first". When the remembered row is the last one, `↓` bounces
input → last row → input indefinitely and row 0 cannot be reached going down.

## Decisions

Both chosen by the user over the alternatives (omnibox-style ring with no
memory; one-shot Esc resume token).

### Rule 1 — the results list is a closed loop

`↓` on the last row wraps to row 0. `↑` on row 0 wraps to the last row.
Neither exits to the input. This makes the first row one keypress from the
last and removes the bounce.

### Rule 2 — every arrow from the input resumes the remembered row

`↓` from the input already resumes. The `↑`-from-input special case that jumps
to the last row is **deleted**, so both arrows mean the same thing: return to
the list where you left off. With the list wrapping, "jump to last" is
redundant — it is one `↑` from row 0.

### Rule 3 — Esc is the only list → input exit

The gesture already in use becomes the single unambiguous way out.

### Rule 4 — emptying the query does nothing

Delete the eager block. No refetch, no clear, no focus change while
backspacing. Discovery restore moves onto the Esc ladder that already exists
(`escLayer === "query"` clears the text, `escLayer === "results"` calls
`clearResults()`), making the reset deliberate rather than a side effect of
typing.

## Carve-outs

These must not regress:

- **Calendar** keeps its own handling. It early-returns through
  `moveCalendarRowFromInput` and must never wrap into the invisible `query`
  zone — that is the dropped-keypress bug the existing comments warn about.
- **Idle zone** keeps its existing ring (`idleReturnLoopModel`).
- **Filter zone** `↓` → list is unchanged.
- The `results-became-empty` guard stays as a safety net for genuinely emptied
  lists; it simply stops firing on the backspace path.

## Implementation notes

`browseFocusZoneReducer` is pure, so the nav rules are unit-testable directly.

- `browse-focus-zone.ts`: drop `if (zone === "list" && ctx.selectedIndex === 0)
return "query";` from the `arrow-up` case, so the list retains focus at the
  top edge. `ctx.selectedIndex` then has no remaining reader and is removed
  from `BrowseFocusZoneContext`.
- `browse-shell.tsx`: wrap at both list edges instead of dispatching
  `focus-query` / `arrow-up`; drop the `setSelectedIndex(length - 1)` on
  `↑`-from-input; delete the empty-query block.

## Testing

- Reducer: wrap at both edges, resume from input, no-results case, and that
  `idle`/`filter` transitions are untouched.
- Shell: emptying the query fires no discovery reload and does not change the
  focus zone.

## Known trade-off

`↓`-on-last-row is no longer a shortcut back to the search box; Esc replaces
it. This is inherent to "the list never dumps you into the input" and is the
one habit that has to be relearned.
