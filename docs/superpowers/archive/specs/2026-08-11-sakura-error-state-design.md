# Sakura Error State — Design

Date: 2026-08-11
Status: approved, not implemented
Surface: playback failure panel (`ErrorShell`)

## Problem

The failure panel has no designed motion. `ErrorShell`
(`apps/cli/src/app-shell/root-status-shells.tsx:123`) is a static crimson box:
a rounded `danger` border, an inner `│ ` gutter, `✗ / ● / ◌` glyphs, scenario
detail, failure waterfall, optional debug excerpt.

Every other signature moment in Kunai carries the sakura motif. `SakuraPetal.tsx`
animates `BLOOM_FRAMES` (`❀ ✿ ❁ ✾`) in rose `accent` while work is in flight and
goes amber `warn` when stalled; `SakuraLoader.tsx` builds the bloom-and-shimmer
loader on top of it. Failure is the one state where the motif drops out entirely
and crimson `danger` is left as a color with nothing behind it.

Failure is also the highest-emotion moment in the app — the thing the user wanted
to watch did not play. It deserves the same craft as the loading state.

## Goals

- Give the failure panel a sakura treatment in the crimson `danger` family.
- Guarantee that the treatment cannot disturb the panel's layout at any width.
- Leave the panel quiet and timer-free by the time the user is reading it.
- Keep the motif visible under `KUNAI_REDUCED_MOTION`.

## Non-goals

- No change to any other surface that uses `palette.danger` (~18 files:
  download manager, setup, tracks panel, settings, notifications, overlays).
- No change to the loading-path motion or to `SakuraLoader`'s behavior.
- No new error copy, no new recovery actions, no change to `ErrorScenario`.

## The motion

Petals fall through the panel — an open field, not a single track — and then
settle.

| Time       | Behavior                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| 0.0s       | Failure lands. Drift opens at full density across the panel.                                                           |
| 0.0 – 5.7s | Petals fall down staggered lanes, glyphs cycling `❀ ✿ ❁ ✾`, in three crimson depths so they read as near, mid and far. |
| 5.7s       | Spawning stops. Petals already in flight finish their fall. No hard cut.                                               |
| ~8s        | The last petal comes to rest in the gutter beside `r retry` and stays there, still, for as long as the panel is up.    |

Cadence is one row per 380ms.

Colors are existing tokens only: `danger` `#ff5d5d` near, `dangerDim` `#a02b2b`
mid, `accentDim` `#7e3350` far. The panel's idle gutter is already `dangerDim`,
so petals in the gutter lane use only `danger` or `accentDim` — never the mid
depth, which would be indistinguishable from the idle `│` behind it.

Three properties are load-bearing and were each chosen against a specific
failure:

**The gutter lane is guaranteed.** Field lanes are best-effort: each yields to
text, so on a narrow terminal they starve and the effect dies exactly when the
panel is most cramped. Column 0 — the `│` gutter `ErrorShell` already draws —
never carries text, so it always has room. The effect is therefore rich when
there is space and a single thinning column of petals when there is not, rather
than rich-or-nothing.

**The fall settles.** A permanent drift keeps a repaint timer alive while the
user is trying to read what broke, and competes with the text for attention.
Spawning stops at ~5.7s and the interval clears once the last petal lands.

**The resting petal is the motif's floor.** The settled state is a static
crimson `❀`. That is what survives reduced motion, and it means the motion ends
by pointing at the recovery action instead of merely stopping.

## Architecture

The open-field effect needs to know which cells the text occupies on each row —
that is how petals yield rather than overwrite. Ink exposes no cell buffer, and
`ErrorShell` today is nested `<Box>`/`<Text>` children with no concept of a row.
The panel therefore becomes an explicit row model, rendered as one `<Text>` per
line.

This follows the model-plus-renderer split the codebase already uses
(`calendar-ui.model.ts`, `details-sheet.model.ts`) and is what makes the motion
testable without rendering.

### `app-shell/playback-error-rows.ts` — new, pure

```ts
type ErrorRowTone = "danger-strong" | "danger" | "ok" | "muted" | "dim";
type ErrorRowSegment = { readonly text: string; readonly tone: ErrorRowTone };
type ErrorRow = { readonly segments: readonly ErrorRowSegment[] };

function buildErrorRows(input: {
  readonly message: string;
  readonly scenario?: ErrorScenario;
  readonly waterfall?: PlaybackFailureWaterfallModel | null;
  readonly debugExcerpt?: ErrorDebugExcerpt | null;
}): readonly ErrorRow[];
```

Moves the layout currently inlined in `ScenarioDetail`, `FailureWaterfall`,
`FailureWaterfallRow` and the debug block out of JSX and into data. Row content
and ordering are unchanged from today's rendering.

Tones map to what those components already render: `danger-strong` is the bold
`palette.danger` headline, `danger` the plain crimson lines, `ok` the succeeded
waterfall markers, `muted` and `dim` the labels and details. The renderer is the
only place that resolves a tone to a token.

### `app-shell/petal-fall.ts` — new, pure

```ts
type PetalPlacement = {
  readonly row: number;
  readonly column: number;
  readonly glyph: string;
  readonly color: string;
};

function petalsForFrame(input: {
  readonly frame: number;
  readonly rowCount: number;
  readonly rowEndColumns: readonly number[];
  readonly width: number;
}): readonly PetalPlacement[];

function settledFrame(rowCount: number): number;
```

Owns the lane schedule, the gutter guarantee, the spawn cutoff and the settle
frame. A pure function from frame to placements — no React, no Ink, no clock.

Lanes are a fixed deterministic schedule of `(column, bornFrame, depth)`, not
random, so golden captures are reproducible. A lane at column 0 is emitted
unconditionally; a lane at column `c > 0` is emitted only when
`c >= rowEndColumns[row] + 1` and the cell is free.

### `ErrorShell` — becomes a renderer

Composes rows and placements into cell arrays, then serializes each row into a
single `<Text>` with colored runs. Keeps its current `useInput` contract
(`r` retry, Enter/Esc dismiss) and its props unchanged.

### `primitives/SakuraPetal.tsx` — extended

`useFrameTick` currently runs forever. It gains an optional `stopAfter` frame
after which it clears its own interval:

```ts
function useFrameTick(active?: boolean, intervalMs?: number, stopAfter?: number): number;
```

Callers that omit `stopAfter` — every existing caller — are unaffected. This
extends the one shared motion policy rather than adding a second timer next to
it. Under reduced motion the hook already pins to 0; `ErrorShell` instead
renders at `settledFrame(rowCount)` so the resting petal shows immediately.

## Layout safety

The constraint is that the treatment must not disturb the panel's layout. It is
enforced structurally rather than by care:

- Petals are written into a per-row **cell array** after text is laid in, never
  inserted into a string. Placement overwrites a padding cell or is skipped.
  A row's length cannot change, so reflow is not merely avoided — it is
  unrepresentable.
- A petal is placed only at `column >= rowEndColumn + 1`, leaving one space of
  breathing room, and never where a cell is occupied.
- Column 0 is reserved for the gutter and never carries text.
- Glyphs are the existing `BLOOM_FRAMES`, all single-cell Dingbats, so the slot
  width cannot shift mid-cycle.

Width comes from `use-viewport-policy.ts`, which already sanitizes
`stdout.columns` (falling back to 80 when the controlling terminal reports 0)
and re-renders on resize. No geometry is cached, so a resize needs no
invalidation — `rowEndColumns` are recomputed and field lanes yield accordingly
on the next frame. The gutter lane is unaffected by width entirely.

## Degradation

| Condition                                   | Behavior                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| Narrow terminal                             | Field lanes starve; gutter lane keeps falling                                    |
| `KUNAI_REDUCED_MOTION` / `NO_MOTION`        | Settled state immediately; static crimson `❀`, no timer                          |
| `layout-policy` reports blocked / too small | No fall; plain rows                                                              |
| Debug excerpt present                       | More rows, longer fall; row count is derived from the row model, never hardcoded |
| Panel unmounts mid-fall                     | Interval cleared on unmount, as with every other `useFrameTick` caller           |

## Testing

**`test/unit/app-shell/petal-fall.test.ts`**

- Placements are deterministic for a given frame and row model.
- **No placement ever collides with text** — asserted across every frame of a
  full fall, at wide, medium and narrow widths, against every `ErrorScenario`
  kind. This is the load-bearing assertion for the layout constraint.
- The gutter lane is populated on every frame during the spawn window.
- `settledFrame` matches the frame after which no placements change.

**`test/unit/app-shell/playback-error-rows.test.ts`**

- Each `ErrorScenario` kind produces the expected rows and segment tones.
- Waterfall rows and the debug excerpt appear in the right order, and are
  omitted when absent.

**Golden captures** via `test/harness/render-capture.ts`:
`playback-error.{wide,medium,narrow}.txt`, rendered at the settled frame. The
settled frame is deterministic, so it captures cleanly. These are what gate the
layout constraint in CI.

## Risk

This repo has a known failure mode in which a repaint loop's synchronous stdout
writes block stdin — the cause of the calendar input-lag bug. `ErrorShell` owns
`r` / Enter / Esc through `useInput`, which puts a repainting failure panel in
that same family.

Mitigations are structural: the clock stops after ~8s, the panel performs no
poster, sixel or Kitty work, and a repaint is roughly twelve rows of text. Ink
erases and repaints the whole frame rather than diffing lines, so the cost is
the frame, not the petals.

This is not fully discharged by the automated tests. Implementation must include
a hand check in a real terminal that `r` stays responsive **during** the fall,
not only after it settles. If it does not, the fix is to lengthen the step
interval or shorten the spawn window — not to keep the drift and accept sticky
input.

## Follow-ups, explicitly out of scope

- Extending the treatment to other `danger` surfaces. Decided against for now:
  most of them are quiet inline lines where a static glyph is correct.
- A loading-to-error handoff, where the loader's in-flight bloom visibly becomes
  the falling petal. Attractive, but it couples the failure panel to the phase
  transition and the loader's motion policy. Revisit once this lands.
