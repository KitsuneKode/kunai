# Sakura Error State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the playback failure panel a sakura petal-fall in the crimson `danger` family that settles after ~8s and cannot disturb the panel's layout at any terminal width.

**Architecture:** `ErrorShell` stops being nested `<Box>`/`<Text>` children and becomes a renderer over two new pure modules: `playback-error-rows.ts` (panel content as row segments) and `petal-fall.ts` (frame → petal placements). Petals are written into a per-row cell array _after_ text is laid in, so a petal can only ever overwrite a padding cell — reflow is unrepresentable rather than merely avoided. The shared `useFrameTick` primitive gains a `stopAfter` frame so the animation clears its own interval once the last petal lands.

**Tech Stack:** Bun, TypeScript, React 19, Ink 5, `bun:test`, the repo's `test/harness/render-capture.ts` harness.

**Spec:** `docs/superpowers/specs/2026-08-11-sakura-error-state-design.md`

## Global Constraints

- Run `bun run test` for tests — **never** `bun test` directly (repo rule, `CLAUDE.md`).
- Before finishing: `bun run typecheck`, `bun run lint`, `bun run fmt`.
- Colors come from `palette` in `apps/cli/src/app-shell/shell-theme.ts` only. No new tokens, no literal hex in components. Petal depths are exactly: near = `palette.danger`, mid = `palette.dangerDim`, far = `palette.accentDim`.
- The panel's idle gutter is already `palette.dangerDim`, so **no gutter-lane petal may use the mid depth** — it would be invisible against the idle `│`.
- Glyphs are the existing `BLOOM_FRAMES` (`❀ ✿ ❁ ✾`) and `STATIC_PETAL` (`❀`) from `apps/cli/src/app-shell/primitives/SakuraPetal.tsx`. All single-cell — never introduce a wider glyph.
- Cadence is one row per **380ms**. Spawning stops after frame **15**. The resting petal sits in the gutter on the **last row**.
- Reduced motion (`KUNAI_REDUCED_MOTION` / `NO_MOTION`) renders the settled frame immediately, with no interval started.
- Layering: `app-shell` may import `ink` and `domain`; it must not import provider or player runtime. `apps/cli/test/unit/architecture/boundary-imports.test.ts` enforces this.
- Scope is `ErrorShell` only. Do not touch any other surface that uses `palette.danger`.

### Two deliberate corrections to the spec

Both are noted here so a reviewer sees them rather than discovering them in a diff:

1. **`ErrorRowTone` needs two more members than the spec listed.** The spec enumerated `"danger-strong" | "danger" | "ok" | "muted" | "dim"`, but today's `ScenarioDetail` renders `/library for downloaded titles` in `palette.accent` and the no-scenario fallback message in `palette.text`. The spec also required row content to be unchanged from today's rendering. Both cannot hold, so the tone union gains `"accent"` and `"text"`.
2. **The debug excerpt loses its nested border.** Today it renders inside its own `borderStyle="single"` box. A nested bordered box cannot be a flat row, and the spec required the debug excerpt to participate in the row model and lengthen the fall. It becomes flat rows under a `debug` label instead. This is a `--debug`-only surface, so the visual change is developer-facing.

---

### Task 1: The pure motion model

**Files:**

- Create: `apps/cli/src/app-shell/petal-fall.ts`
- Test: `apps/cli/test/unit/app-shell/petal-fall.test.ts`

**Interfaces:**

- Consumes: `BLOOM_FRAMES`, `STATIC_PETAL` from `apps/cli/src/app-shell/primitives/SakuraPetal.tsx`; `palette` from `apps/cli/src/app-shell/shell-theme.ts`.
- Produces:
  - `type PetalPlacement = { readonly row: number; readonly column: number; readonly glyph: string; readonly color: string }`
  - `function petalsForFrame(input: { frame: number; rowCount: number; rowEndColumns: readonly number[]; width: number }): readonly PetalPlacement[]`
  - `function settledFrame(rowCount: number): number`
  - `const PETAL_STEP_MS: 380`
  - `const GUTTER_COLUMN: 0`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/app-shell/petal-fall.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { BLOOM_FRAMES, STATIC_PETAL } from "@/app-shell/primitives/SakuraPetal";
import { GUTTER_COLUMN, PETAL_STEP_MS, petalsForFrame, settledFrame } from "@/app-shell/petal-fall";
import { palette } from "@/app-shell/shell-theme";

// A realistic panel: 10 rows, text starting at column 2, of varying lengths.
const ROW_TEXT = [
  "Playback failed",
  "✗  timed out after 12s",
  "   allmanga",
  "",
  "resolve trail  ·  /diagnostics",
  "✓ search   · 0.4s",
  "✓ scrape   · 1.1s",
  "x resolve  · timed out",
  "",
  "r retry  ·  Enter / Esc dismiss",
];
const ROW_COUNT = ROW_TEXT.length;
const rowEnds = () => ROW_TEXT.map((text) => 2 + [...text].length);

describe("petalsForFrame", () => {
  test("cadence is 380ms and the gutter is column 0", () => {
    expect(PETAL_STEP_MS).toBe(380);
    expect(GUTTER_COLUMN).toBe(0);
  });

  test("is deterministic for a given frame", () => {
    const first = petalsForFrame({
      frame: 7,
      rowCount: ROW_COUNT,
      rowEndColumns: rowEnds(),
      width: 76,
    });
    const second = petalsForFrame({
      frame: 7,
      rowCount: ROW_COUNT,
      rowEndColumns: rowEnds(),
      width: 76,
    });
    expect(second).toEqual(first);
  });

  // The load-bearing assertion for the layout constraint.
  test("never places a petal on a cell the text occupies, at any width", () => {
    for (const width of [40, 60, 76, 120]) {
      const ends = rowEnds();
      for (let frame = 0; frame <= settledFrame(ROW_COUNT) + 3; frame++) {
        for (const petal of petalsForFrame({
          frame,
          rowCount: ROW_COUNT,
          rowEndColumns: ends,
          width,
        })) {
          expect(petal.row).toBeGreaterThanOrEqual(0);
          expect(petal.row).toBeLessThan(ROW_COUNT);
          expect(petal.column).toBeLessThan(width);
          if (petal.column !== GUTTER_COLUMN) {
            // One space of breathing room past the end of the text.
            expect(petal.column).toBeGreaterThanOrEqual((ends[petal.row] ?? 0) + 1);
          }
        }
      }
    }
  });

  test("never places two petals on the same cell", () => {
    for (let frame = 0; frame <= settledFrame(ROW_COUNT); frame++) {
      const placements = petalsForFrame({
        frame,
        rowCount: ROW_COUNT,
        rowEndColumns: rowEnds(),
        width: 76,
      });
      const keys = placements.map((petal) => `${petal.row}:${petal.column}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  test("the gutter lane keeps falling on a terminal too narrow for field lanes", () => {
    // width 24 leaves no room to the right of the text on most rows.
    const frames: number[] = [];
    for (let frame = 0; frame < settledFrame(ROW_COUNT); frame++) {
      const placements = petalsForFrame({
        frame,
        rowCount: ROW_COUNT,
        rowEndColumns: rowEnds(),
        width: 24,
      });
      if (placements.some((petal) => petal.column === GUTTER_COLUMN)) frames.push(frame);
    }
    expect(frames.length).toBeGreaterThan(0);
  });

  test("no gutter petal uses the mid depth, which would vanish against the idle gutter", () => {
    for (let frame = 0; frame <= settledFrame(ROW_COUNT); frame++) {
      for (const petal of petalsForFrame({
        frame,
        rowCount: ROW_COUNT,
        rowEndColumns: rowEnds(),
        width: 76,
      })) {
        if (petal.column === GUTTER_COLUMN) {
          expect(petal.color).not.toBe(palette.dangerDim);
        }
      }
    }
  });

  test("only ever uses single-cell bloom glyphs", () => {
    const allowed = new Set<string>([...BLOOM_FRAMES, STATIC_PETAL]);
    for (let frame = 0; frame <= settledFrame(ROW_COUNT); frame++) {
      for (const petal of petalsForFrame({
        frame,
        rowCount: ROW_COUNT,
        rowEndColumns: rowEnds(),
        width: 76,
      })) {
        expect(allowed.has(petal.glyph)).toBe(true);
        expect([...petal.glyph]).toHaveLength(1);
      }
    }
  });

  test("settles to one still petal in the gutter beside the last row", () => {
    const settled = settledFrame(ROW_COUNT);
    const placements = petalsForFrame({
      frame: settled,
      rowCount: ROW_COUNT,
      rowEndColumns: rowEnds(),
      width: 76,
    });
    expect(placements).toEqual([
      { row: ROW_COUNT - 1, column: GUTTER_COLUMN, glyph: STATIC_PETAL, color: palette.danger },
    ]);
  });

  test("stays settled after the settle frame", () => {
    const settled = settledFrame(ROW_COUNT);
    const at = petalsForFrame({
      frame: settled,
      rowCount: ROW_COUNT,
      rowEndColumns: rowEnds(),
      width: 76,
    });
    const later = petalsForFrame({
      frame: settled + 25,
      rowCount: ROW_COUNT,
      rowEndColumns: rowEnds(),
      width: 76,
    });
    expect(later).toEqual(at);
  });

  test("a taller panel takes longer to settle", () => {
    expect(settledFrame(14)).toBeGreaterThan(settledFrame(10));
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun run --cwd apps/cli test:file test/unit/app-shell/petal-fall.test.ts`
Expected: FAIL — cannot resolve module `@/app-shell/petal-fall`.

- [ ] **Step 3: Write the implementation**

Create `apps/cli/src/app-shell/petal-fall.ts`:

```ts
// =============================================================================
// petal-fall.ts — the failure-state petal fall, as a pure function of frame
//
// Placement is deliberately data, not drawing: `petalsForFrame` answers "which
// cells hold a petal on frame N" and nothing else. The renderer writes those
// cells into a row buffer AFTER the text is laid in, so a petal can only ever
// overwrite padding. That is what makes the effect incapable of reflowing the
// panel, rather than merely careful not to.
//
// Lanes are a fixed schedule, not random: golden captures and the no-collision
// test both need the same petals on the same frame every run.
// =============================================================================

import { BLOOM_FRAMES, STATIC_PETAL } from "./primitives/SakuraPetal";
import { palette } from "./shell-theme";

/** One petal occupying one cell for one frame. */
export type PetalPlacement = {
  readonly row: number;
  readonly column: number;
  readonly glyph: string;
  readonly color: string;
};

/** Column 0 is the `│` gutter ErrorShell already draws. Text never occupies it. */
export const GUTTER_COLUMN = 0;

/** One row per step. Slow enough to read as drifting rather than scrolling. */
export const PETAL_STEP_MS = 380;

/** No petal is born after this frame (~5.7s), so the sky empties on its own. */
const SPAWN_UNTIL = 15;

/** Text begins at column 2; a field petal needs one more space of clearance. */
const TEXT_CLEARANCE = 1;

type LaneDepth = "near" | "mid" | "far";

type Lane = {
  readonly column: number;
  readonly born: number;
  readonly depth: LaneDepth;
};

/**
 * Column-0 lanes are the guaranteed gutter track — they never yield to text, so
 * the effect thins to a single column on a narrow terminal instead of starving
 * to nothing. None of them use `mid`, which is the gutter's own idle color.
 */
const LANES: readonly Lane[] = [
  { column: 0, born: 0, depth: "near" },
  { column: 27, born: 1, depth: "far" },
  { column: 13, born: 3, depth: "mid" },
  { column: 45, born: 4, depth: "far" },
  { column: 0, born: 6, depth: "far" },
  { column: 35, born: 7, depth: "near" },
  { column: 20, born: 9, depth: "far" },
  { column: 0, born: 11, depth: "far" },
  { column: 41, born: 12, depth: "mid" },
  { column: 30, born: 13, depth: "near" },
  { column: 0, born: SPAWN_UNTIL, depth: "near" },
];

function depthColor(depth: LaneDepth): string {
  if (depth === "near") return palette.danger;
  if (depth === "mid") return palette.dangerDim;
  return palette.accentDim;
}

/**
 * The frame at which the last petal reaches the bottom row. From here on the
 * panel is still, and the caller's clock should stop.
 */
export function settledFrame(rowCount: number): number {
  const lastBorn = LANES.reduce((max, lane) => Math.max(max, lane.born), 0);
  return lastBorn + Math.max(0, rowCount - 1);
}

/**
 * @param rowEndColumns - for each row, the column just past its last text cell
 *   (panel-inner coordinates, where column 0 is the gutter).
 */
export function petalsForFrame(input: {
  readonly frame: number;
  readonly rowCount: number;
  readonly rowEndColumns: readonly number[];
  readonly width: number;
}): readonly PetalPlacement[] {
  const { frame, rowCount, rowEndColumns, width } = input;
  if (rowCount <= 0) return [];

  const restRow = rowCount - 1;
  if (frame >= settledFrame(rowCount)) {
    return [{ row: restRow, column: GUTTER_COLUMN, glyph: STATIC_PETAL, color: palette.danger }];
  }

  const placements: PetalPlacement[] = [];
  const taken = new Set<string>();

  for (const [index, lane] of LANES.entries()) {
    if (lane.column >= width) continue;

    const row = frame - lane.born;
    if (row < 0 || row >= rowCount) continue;

    // Field lanes yield to text; the gutter lane always has room.
    if (lane.column !== GUTTER_COLUMN) {
      const end = rowEndColumns[row] ?? 0;
      if (lane.column < end + TEXT_CLEARANCE) continue;
    }

    const key = `${row}:${lane.column}`;
    if (taken.has(key)) continue;
    taken.add(key);

    placements.push({
      row,
      column: lane.column,
      glyph: BLOOM_FRAMES[(frame + index) % BLOOM_FRAMES.length] ?? STATIC_PETAL,
      color: depthColor(lane.depth),
    });
  }

  return placements;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun run --cwd apps/cli test:file test/unit/app-shell/petal-fall.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/petal-fall.ts apps/cli/test/unit/app-shell/petal-fall.test.ts
git commit -m "feat(app-shell): pure petal-fall placement model for the failure panel"
```

---

### Task 2: The pure row model

**Files:**

- Create: `apps/cli/src/app-shell/playback-error-rows.ts`
- Test: `apps/cli/test/unit/app-shell/playback-error-rows.test.ts`

**Interfaces:**

- Consumes: `ErrorScenario` from `@/domain/playback/playback-problem`; `PlaybackFailureWaterfallModel` from `./playback-failure-waterfall`; `ErrorDebugExcerpt` from `./error-debug-excerpt`.
- Produces:
  - `type ErrorRowTone = "danger-strong" | "danger" | "accent" | "text" | "ok" | "muted" | "dim"`
  - `type ErrorRowSegment = { readonly text: string; readonly tone: ErrorRowTone }`
  - `type ErrorRow = { readonly segments: readonly ErrorRowSegment[] }`
  - `function buildErrorRows(input: { message: string; scenario?: ErrorScenario; waterfall?: PlaybackFailureWaterfallModel | null; debugExcerpt?: ErrorDebugExcerpt | null; canRetry: boolean }): readonly ErrorRow[]`
  - `function rowText(row: ErrorRow): string`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/app-shell/playback-error-rows.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { buildErrorRows, rowText } from "@/app-shell/playback-error-rows";

const base = { message: "An unknown error occurred", canRetry: true };

const linesOf = (input: Parameters<typeof buildErrorRows>[0]) => buildErrorRows(input).map(rowText);

describe("buildErrorRows", () => {
  test("always opens with the headline and closes with the actions row", () => {
    const lines = linesOf(base);
    expect(lines[0]).toBe("Playback failed");
    expect(lines.at(-1)).toBe("r retry  ·  Enter / Esc dismiss");
  });

  test("the headline is the only danger-strong row", () => {
    const rows = buildErrorRows(base);
    const strong = rows.filter((row) => row.segments.some((s) => s.tone === "danger-strong"));
    expect(strong).toHaveLength(1);
    expect(rowText(strong[0]!)).toBe("Playback failed");
  });

  test("drops the retry hint when retry is unavailable", () => {
    expect(linesOf({ ...base, canRetry: false }).at(-1)).toBe("Enter / Esc to continue");
  });

  test("falls back to the raw message when there is no scenario", () => {
    expect(linesOf(base)).toContain("An unknown error occurred");
  });

  test("renders provider-timeout", () => {
    const lines = linesOf({
      ...base,
      scenario: { kind: "provider-timeout", providerName: "allmanga", elapsedSec: 12 },
    });
    expect(lines).toContain("✗  timed out after 12s");
    expect(lines).toContain("allmanga");
    expect(lines).toContain("r retry · /fallback for another provider");
  });

  test("renders stream-broken", () => {
    const lines = linesOf({
      ...base,
      scenario: { kind: "stream-broken", attempt: 2, maxAttempts: 3 },
    });
    expect(lines).toContain("✗  stream interrupted");
    expect(lines).toContain("attempt 2 of 3");
  });

  test("renders network-offline, keeping the library hint on accent", () => {
    const rows = buildErrorRows({ ...base, scenario: { kind: "network-offline" } });
    expect(rows.map(rowText)).toContain("○  offline");
    const hint = rows.find((row) => rowText(row) === "/library for downloaded titles");
    expect(hint?.segments[0]?.tone).toBe("accent");
  });

  test("renders provider-session", () => {
    const lines = linesOf({
      ...base,
      scenario: { kind: "provider-session", providerName: "Videasy" },
    });
    expect(lines).toContain("●  Videasy session required");
  });

  test("renders title-unavailable", () => {
    const lines = linesOf({
      ...base,
      scenario: { kind: "title-unavailable", title: "Dune" },
    });
    expect(lines).toContain("◌  Dune not found");
  });

  test("renders the waterfall with status-toned markers", () => {
    const rows = buildErrorRows({
      ...base,
      waterfall: {
        title: "Source attempts",
        truncated: false,
        rows: [
          { label: "search", detail: "0.4s", status: "succeeded" },
          { label: "resolve", detail: "timed out", status: "failed" },
          { label: "play", detail: null, status: "running" },
        ],
      },
    });
    const lines = rows.map(rowText);
    expect(lines).toContain("Source attempts");
    expect(lines).toContain("✓ search  ·  0.4s");
    expect(lines).toContain("x resolve  ·  timed out");
    expect(lines).toContain("· play");

    const succeeded = rows.find((row) => rowText(row).startsWith("✓ search"));
    expect(succeeded?.segments[0]?.tone).toBe("ok");
    const failed = rows.find((row) => rowText(row).startsWith("x resolve"));
    expect(failed?.segments[0]?.tone).toBe("danger");
  });

  test("marks a truncated waterfall", () => {
    const lines = linesOf({
      ...base,
      waterfall: {
        title: "Provider attempts",
        truncated: true,
        rows: [{ label: "search", detail: null, status: "failed" }],
      },
    });
    expect(lines).toContain("Provider attempts  ·  more in /diagnostics");
  });

  test("appends the debug excerpt when present, and omits it otherwise", () => {
    const withDebug = linesOf({
      ...base,
      debugExcerpt: { message: "ECONNRESET", topFrame: "at resolve (x.ts:1:1)" },
    });
    expect(withDebug).toContain("debug");
    expect(withDebug).toContain("ECONNRESET");
    expect(withDebug).toContain("at resolve (x.ts:1:1)");

    expect(linesOf(base)).not.toContain("debug");
  });

  test("a longer panel produces more rows, which lengthens the fall", () => {
    const short = buildErrorRows(base).length;
    const long = buildErrorRows({
      ...base,
      scenario: { kind: "provider-timeout", providerName: "allmanga", elapsedSec: 12 },
      waterfall: {
        title: "Source attempts",
        truncated: false,
        rows: [{ label: "search", detail: "0.4s", status: "succeeded" }],
      },
      debugExcerpt: { message: "ECONNRESET", topFrame: null },
    }).length;
    expect(long).toBeGreaterThan(short);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun run --cwd apps/cli test:file test/unit/app-shell/playback-error-rows.test.ts`
Expected: FAIL — cannot resolve module `@/app-shell/playback-error-rows`.

- [ ] **Step 3: Write the implementation**

Create `apps/cli/src/app-shell/playback-error-rows.ts`:

```ts
// =============================================================================
// playback-error-rows.ts — the failure panel's content, as rows of segments
//
// ErrorShell used to build its layout inline as nested Boxes. The petal fall
// needs to know which cells each row's text occupies, and Ink exposes no cell
// buffer, so the content becomes data first and is rendered second. Row content
// and ordering match what the panel rendered before this module existed.
// =============================================================================

import type { ErrorScenario } from "@/domain/playback/playback-problem";

import type { ErrorDebugExcerpt } from "./error-debug-excerpt";
import type { PlaybackFailureWaterfallModel } from "./playback-failure-waterfall";

export type ErrorRowTone = "danger-strong" | "danger" | "accent" | "text" | "ok" | "muted" | "dim";

export type ErrorRowSegment = { readonly text: string; readonly tone: ErrorRowTone };
export type ErrorRow = { readonly segments: readonly ErrorRowSegment[] };

const BLANK: ErrorRow = { segments: [] };

const row = (text: string, tone: ErrorRowTone): ErrorRow => ({ segments: [{ text, tone }] });

/** The plain text of a row — what the renderer measures and tests assert on. */
export function rowText(input: ErrorRow): string {
  return input.segments.map((segment) => segment.text).join("");
}

function scenarioRows(scenario: ErrorScenario): readonly ErrorRow[] {
  switch (scenario.kind) {
    case "provider-timeout":
      return [
        row(`✗  timed out after ${scenario.elapsedSec}s`, "danger"),
        row(scenario.providerName, "dim"),
        row("r retry · /fallback for another provider", "dim"),
      ];
    case "stream-broken":
      return [
        row("✗  stream interrupted", "danger"),
        row(`attempt ${scenario.attempt} of ${scenario.maxAttempts}`, "dim"),
        row("r retry · /recover to refresh the stream", "dim"),
      ];
    case "network-offline":
      return [row("○  offline", "dim"), row("/library for downloaded titles", "accent")];
    case "provider-session":
      return [
        row(`●  ${scenario.providerName} session required`, "danger"),
        row("/settings · add Videasy session token", "dim"),
        row("/fallback for another provider", "dim"),
      ];
    case "title-unavailable":
      return [
        row(`◌  ${scenario.title} not found`, "dim"),
        row("r retry · /watchlist to save for later", "dim"),
      ];
  }
}

function waterfallRows(model: PlaybackFailureWaterfallModel): readonly ErrorRow[] {
  const heading = `${model.title}${model.truncated ? "  ·  more in /diagnostics" : ""}`;
  const rows: ErrorRow[] = [BLANK, row(heading, "dim")];

  for (const entry of model.rows) {
    const marker = entry.status === "succeeded" ? "✓" : entry.status === "failed" ? "x" : "·";
    const tone: ErrorRowTone =
      entry.status === "succeeded" ? "ok" : entry.status === "failed" ? "danger" : "dim";
    const segments: ErrorRowSegment[] = [{ text: `${marker} ${entry.label}`, tone }];
    if (entry.detail) segments.push({ text: `  ·  ${entry.detail}`, tone: "dim" });
    rows.push({ segments });
  }

  return rows;
}

function debugRows(excerpt: ErrorDebugExcerpt): readonly ErrorRow[] {
  const rows: ErrorRow[] = [BLANK, row("debug", "dim"), row(excerpt.message, "muted")];
  if (excerpt.topFrame) rows.push(row(excerpt.topFrame, "dim"));
  return rows;
}

export function buildErrorRows(input: {
  readonly message: string;
  readonly scenario?: ErrorScenario;
  readonly waterfall?: PlaybackFailureWaterfallModel | null;
  readonly debugExcerpt?: ErrorDebugExcerpt | null;
  readonly canRetry: boolean;
}): readonly ErrorRow[] {
  const rows: ErrorRow[] = [row("Playback failed", "danger-strong")];

  rows.push(...(input.scenario ? scenarioRows(input.scenario) : [row(input.message, "text")]));
  if (input.waterfall) rows.push(...waterfallRows(input.waterfall));
  if (input.debugExcerpt) rows.push(...debugRows(input.debugExcerpt));

  rows.push(
    BLANK,
    row(input.canRetry ? "r retry  ·  Enter / Esc dismiss" : "Enter / Esc to continue", "dim"),
  );

  return rows;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun run --cwd apps/cli test:file test/unit/app-shell/playback-error-rows.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/app-shell/playback-error-rows.ts apps/cli/test/unit/app-shell/playback-error-rows.test.ts
git commit -m "feat(app-shell): extract the failure panel's content into a pure row model"
```

---

### Task 3: A frame clock that stops

**Files:**

- Modify: `apps/cli/src/app-shell/primitives/SakuraPetal.tsx:37-46` (`useFrameTick`)
- Test: `apps/cli/test/unit/app-shell/sakura-frame-tick.test.tsx`

**Interfaces:**

- Produces: `useFrameTick(active?: boolean, intervalMs?: number, stopAfter?: number): number` — an added third parameter. Every existing caller omits it and is unaffected.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/app-shell/sakura-frame-tick.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test";
import { Text } from "ink";
import React from "react";

import { useFrameTick } from "@/app-shell/primitives/SakuraPetal";
import { simulateTicks } from "../../harness/render-capture";

function Probe({ stopAfter }: { readonly stopAfter?: number }) {
  const tick = useFrameTick(true, 380, stopAfter);
  return <Text>{`tick=${tick}`}</Text>;
}

describe("useFrameTick", () => {
  test("without stopAfter it keeps ticking for the whole window", () => {
    // 1 mount frame + 6 ticks, each a distinct tick value.
    const report = simulateTicks(<Probe />, { rounds: 6 });
    expect(report.distinctFrames).toBe(7);
  });

  test("stops committing new frames once stopAfter is reached", () => {
    // Ticks 0,1,2,3 are distinct; the interval clears at 3 and rounds 4-9 add nothing.
    const report = simulateTicks(<Probe stopAfter={3} />, { rounds: 9 });
    expect(report.distinctFrames).toBe(4);
  });

  test("stopAfter of 0 never starts a clock", () => {
    const report = simulateTicks(<Probe stopAfter={0} />, { rounds: 5 });
    expect(report.distinctFrames).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun run --cwd apps/cli test:file test/unit/app-shell/sakura-frame-tick.test.tsx`
Expected: FAIL — `stopAfter={3}` is ignored, so the probe keeps ticking and `distinctFrames` is 10, not 4.

- [ ] **Step 3: Write the implementation**

In `apps/cli/src/app-shell/primitives/SakuraPetal.tsx`, replace `useFrameTick` (lines 32-46, docstring included) with:

```tsx
/**
 * Monotonic frame tick shared by the loader's shimmer/drift. `active` pauses the
 * clock (viewport-freeze) and reduced-motion pins it to 0, so callers can derive
 * any cycle length via modulo without spinning a timer no one can see.
 *
 * `stopAfter` bounds the clock: once the tick reaches it, the interval clears
 * itself and the surface goes permanently still. One-shot animations use this
 * so a settled surface is not paying for a timer nobody can see either. Omitting
 * it keeps the original run-forever behavior.
 */
export function useFrameTick(
  active = true,
  intervalMs = FRAME_INTERVAL_MS,
  stopAfter?: number,
): number {
  const [tick, setTick] = React.useState(0);
  const animate = active && !reducedMotionEnabled();
  React.useEffect(() => {
    if (!animate) return undefined;
    if (stopAfter !== undefined && stopAfter <= 0) return undefined;
    // Counted outside the state updater: the updater must stay pure, and React
    // may invoke it more than once per commit.
    let current = 0;
    const timer = setInterval(() => {
      current += 1;
      setTick(current);
      if (stopAfter !== undefined && current >= stopAfter) clearInterval(timer);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [animate, intervalMs, stopAfter]);
  return animate ? tick : 0;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun run --cwd apps/cli test:file test/unit/app-shell/sakura-frame-tick.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Verify no existing caller regressed**

Run: `bun run --cwd apps/cli test:unit`
Expected: PASS. `SakuraLoader` and `SakuraBloom` omit `stopAfter`, so their behavior is unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/primitives/SakuraPetal.tsx apps/cli/test/unit/app-shell/sakura-frame-tick.test.tsx
git commit -m "feat(app-shell): let useFrameTick bound itself with stopAfter"
```

---

### Task 4: ErrorShell becomes a renderer

**Files:**

- Modify: `apps/cli/src/app-shell/root-status-shells.tsx:62-222` (replace `ScenarioDetail`, `ErrorShell`, `FailureWaterfall`, `FailureWaterfallRow`)
- Test: `apps/cli/test/unit/app-shell/error-shell.test.tsx`

**Interfaces:**

- Consumes: `buildErrorRows`, `rowText`, `type ErrorRow`, `type ErrorRowTone` (Task 2); `petalsForFrame`, `settledFrame`, `PETAL_STEP_MS`, `GUTTER_COLUMN` (Task 1); `useFrameTick`, `reducedMotionEnabled` (Task 3).
- Produces: `ErrorShell` with its **props unchanged** — `{ message, scenario?, waterfall?, debugEnabled?, debugError?, onResolve, onRetry? }`. `renderErrorRootContent` in `root-content-shell.tsx:65` needs no edit.

**Why the panel gets an explicit width:** Ink sizes a bordered box to its longest child. Petals land in different columns on different frames, so without a fixed width the right border would move frame to frame — the exact layout break this feature must not cause. `PANEL_WIDTH` is derived from terminal columns only, never from petals.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/unit/app-shell/error-shell.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test";
import React from "react";

import { ErrorShell } from "@/app-shell/root-status-shells";
import { CAPTURE_WIDTHS, captureFrame, render } from "../../harness/render-capture";

const props = {
  message: "An unknown error occurred",
  scenario: { kind: "provider-timeout", providerName: "allmanga", elapsedSec: 12 } as const,
  waterfall: {
    title: "Source attempts",
    truncated: false,
    rows: [
      { label: "search", detail: "0.4s", status: "succeeded" as const },
      { label: "resolve", detail: "timed out", status: "failed" as const },
    ],
  },
  onResolve: () => {},
  onRetry: () => {},
};

/** Longest line in the frame — the panel's outer width as actually rendered. */
const frameWidth = (frame: string) =>
  Math.max(...frame.split("\n").map((line) => [...line.trimEnd()].length));

describe("ErrorShell", () => {
  test("renders the headline, scenario detail and waterfall", () => {
    const frame = captureFrame(<ErrorShell {...props} />, { columns: CAPTURE_WIDTHS.medium });
    expect(frame).toContain("Playback failed");
    expect(frame).toContain("timed out after 12s");
    expect(frame).toContain("allmanga");
    expect(frame).toContain("Source attempts");
    expect(frame).toContain("resolve");
    expect(frame).toContain("r retry");
  });

  test("falls back to the raw message with no scenario", () => {
    const frame = captureFrame(<ErrorShell message="boom" onResolve={() => {}} />, {
      columns: CAPTURE_WIDTHS.medium,
    });
    expect(frame).toContain("boom");
  });

  // The layout constraint, asserted on real rendered frames.
  test("panel width never changes across the frames of the fall", () => {
    const handle = render(<ErrorShell {...props} />, { columns: CAPTURE_WIDTHS.medium });
    try {
      const widths = new Set(
        handle.frames.filter((frame) => frame.includes("Playback failed")).map(frameWidth),
      );
      expect(widths.size).toBe(1);
    } finally {
      handle.unmount();
    }
  });

  test("renders at every canonical width without exceeding the terminal", () => {
    for (const columns of Object.values(CAPTURE_WIDTHS)) {
      const frame = captureFrame(<ErrorShell {...props} />, { columns });
      expect(frame).toContain("Playback failed");
      for (const line of frame.split("\n")) {
        expect([...line.trimEnd()].length).toBeLessThanOrEqual(columns);
      }
    }
  });

  test("r triggers retry", () => {
    let retried = 0;
    const handle = render(
      <ErrorShell
        {...props}
        onRetry={() => {
          retried += 1;
        }}
      />,
      { columns: CAPTURE_WIDTHS.medium },
    );
    try {
      handle.stdin.enqueue("r");
      expect(retried).toBe(1);
    } finally {
      handle.unmount();
    }
  });

  test("Enter resolves", () => {
    let resolved = 0;
    const handle = render(
      <ErrorShell
        {...props}
        onResolve={() => {
          resolved += 1;
        }}
      />,
      { columns: CAPTURE_WIDTHS.medium },
    );
    try {
      handle.stdin.enqueue("\r");
      expect(resolved).toBe(1);
    } finally {
      handle.unmount();
    }
  });

  test("under reduced motion it renders the settled panel with no clock", async () => {
    const previous = process.env.KUNAI_REDUCED_MOTION;
    process.env.KUNAI_REDUCED_MOTION = "1";
    try {
      const handle = render(<ErrorShell {...props} />, { columns: CAPTURE_WIDTHS.medium });
      try {
        await new Promise((resolve) => setTimeout(resolve, 500));
        // A still panel commits its mount frame and nothing further.
        expect(new Set(handle.frames).size).toBe(1);
        expect(handle.lastFrame()).toContain("Playback failed");
      } finally {
        handle.unmount();
      }
    } finally {
      if (previous === undefined) delete process.env.KUNAI_REDUCED_MOTION;
      else process.env.KUNAI_REDUCED_MOTION = previous;
    }
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun run --cwd apps/cli test:file test/unit/app-shell/error-shell.test.tsx`
Expected: FAIL — the width and reduced-motion tests fail against today's static panel (no fixed width, no settled-frame path).

- [ ] **Step 3: Replace the render path**

In `apps/cli/src/app-shell/root-status-shells.tsx`, delete `ScenarioDetail` (lines 62-121), `FailureWaterfall` (194-206) and `FailureWaterfallRow` (208-222) — that layout now lives in `buildErrorRows`. Replace the imports and `ErrorShell` with:

```tsx
import { useShellDimensions } from "./use-viewport-policy";
import { buildErrorRows, type ErrorRow, type ErrorRowTone, rowText } from "./playback-error-rows";
import {
  GUTTER_COLUMN,
  PETAL_STEP_MS,
  type PetalPlacement,
  petalsForFrame,
  settledFrame,
} from "./petal-fall";
import { reducedMotionEnabled, useFrameTick } from "./primitives/SakuraPetal";

/** Text begins here; column 0 is the gutter and column 1 is its trailing space. */
const TEXT_COLUMN = 2;
/** Chrome around the panel's inner content: border + padding on both sides. */
const PANEL_CHROME = 6;
const MIN_PANEL_WIDTH = 30;
const MAX_PANEL_WIDTH = 76;

type Cell = { readonly ch: string; readonly color: string; readonly bold: boolean };

function toneColor(tone: ErrorRowTone): string {
  switch (tone) {
    case "danger-strong":
    case "danger":
      return palette.danger;
    case "accent":
      return palette.accent;
    case "text":
      return palette.text;
    case "ok":
      return palette.ok;
    case "muted":
      return palette.muted;
    default:
      return palette.dim;
  }
}

/**
 * Lay a row's text into a cell buffer, then drop this row's petals into it.
 * Petals are written LAST and only into cells the text left empty, so a petal
 * can never lengthen the row — which is what makes reflow impossible rather
 * than merely unlikely.
 */
function rowCells(row: ErrorRow, petals: readonly PetalPlacement[], width: number): Cell[] {
  const cells: Cell[] = [{ ch: "│", color: palette.dangerDim, bold: false }];
  while (cells.length < TEXT_COLUMN) {
    cells.push({ ch: " ", color: palette.dim, bold: false });
  }

  for (const segment of row.segments) {
    const color = toneColor(segment.tone);
    const bold = segment.tone === "danger-strong";
    for (const ch of segment.text) {
      if (cells.length >= width) break;
      cells.push({ ch, color, bold });
    }
  }

  for (const petal of petals) {
    if (petal.column >= width) continue;
    while (cells.length <= petal.column) {
      cells.push({ ch: " ", color: palette.dim, bold: false });
    }
    if (cells[petal.column]!.ch !== " " && petal.column !== GUTTER_COLUMN) continue;
    cells[petal.column] = { ch: petal.glyph, color: petal.color, bold: true };
  }

  return cells;
}

/** Collapse a cell buffer into as few <Text> runs as the colors allow. */
function ErrorRowLine({
  row,
  petals,
  width,
}: {
  readonly row: ErrorRow;
  readonly petals: readonly PetalPlacement[];
  readonly width: number;
}) {
  const cells = rowCells(row, petals, width);
  const runs: { text: string; color: string; bold: boolean }[] = [];
  for (const cell of cells) {
    const last = runs.at(-1);
    if (last && last.color === cell.color && last.bold === cell.bold) last.text += cell.ch;
    else runs.push({ text: cell.ch, color: cell.color, bold: cell.bold });
  }
  return (
    <Text>
      {runs.map((run, index) => (
        // eslint-disable-next-line react/no-array-index-key -- runs are positional by construction
        <Text key={`r-${index}`} color={run.color} bold={run.bold}>
          {run.text}
        </Text>
      ))}
    </Text>
  );
}

export function ErrorShell({
  message,
  scenario,
  waterfall,
  debugEnabled = false,
  debugError,
  onResolve,
  onRetry,
}: {
  message: string;
  scenario?: ErrorScenario;
  waterfall?: PlaybackFailureWaterfallModel | null;
  debugEnabled?: boolean;
  debugError?: unknown;
  onResolve: () => void;
  onRetry?: () => void;
}) {
  // Memoized on its inputs, not recomputed per render: it is a dependency of
  // the row model below, and a fresh object each render would defeat that memo.
  const debugExcerpt = React.useMemo(
    () => (debugEnabled ? extractErrorDebugExcerpt(debugError) : null),
    [debugEnabled, debugError],
  );

  useInput((input, key) => {
    if (key.return || key.escape) {
      onResolve();
      return;
    }
    if (input.toLowerCase() === "r" && onRetry) {
      onRetry();
    }
  });

  const rows = React.useMemo(
    () =>
      buildErrorRows({ message, scenario, waterfall, debugExcerpt, canRetry: Boolean(onRetry) }),
    [message, scenario, waterfall, debugExcerpt, onRetry],
  );

  // Width comes from the terminal alone — never from the petals, or the border
  // would move frame to frame.
  const { cols } = useShellDimensions();
  const width = Math.max(MIN_PANEL_WIDTH, Math.min(cols - PANEL_CHROME, MAX_PANEL_WIDTH));

  const settled = settledFrame(rows.length);
  const tick = useFrameTick(true, PETAL_STEP_MS, settled);
  const frame = reducedMotionEnabled() ? settled : tick;

  const rowEndColumns = React.useMemo(
    () => rows.map((row) => TEXT_COLUMN + [...rowText(row)].length),
    [rows],
  );
  const petals = petalsForFrame({ frame, rowCount: rows.length, rowEndColumns, width });

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={palette.danger}
      paddingX={1}
      width={width + 4}
    >
      {rows.map((row, index) => (
        <ErrorRowLine
          // eslint-disable-next-line react/no-array-index-key -- rows are positional by construction
          key={`row-${index}`}
          row={row}
          petals={petals.filter((petal) => petal.row === index)}
          width={width}
        />
      ))}
    </Box>
  );
}
```

Keep the existing imports for `Box`, `Text`, `useInput`, `React`, `palette`, `extractErrorDebugExcerpt`, `ErrorScenario` and `PlaybackFailureWaterfallModel`. Drop the now-unused `PlaybackFailureWaterfallRow` import.

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun run --cwd apps/cli test:file test/unit/app-shell/error-shell.test.tsx`
Expected: PASS — 7 tests.

- [ ] **Step 5: Run typecheck, lint and the full unit suite**

```bash
bun run typecheck
bun run lint
bun run --cwd apps/cli test:unit
```

Expected: all pass, including `test/unit/architecture/boundary-imports.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app-shell/root-status-shells.tsx apps/cli/test/unit/app-shell/error-shell.test.tsx
git commit -m "feat(app-shell): render the failure panel as cells with a sakura petal fall"
```

---

### Task 5: Golden captures, manual verification, and docs

**Files:**

- Create: `apps/cli/test/harness/capture-playback-error.tsx`
- Create: `apps/cli/test/__captures__/playback-error.{narrow,medium,wide}.txt` (generated)
- Modify: `.docs/design-system.md`

**Interfaces:**

- Consumes: `ErrorShell` (Task 4), `captureSurface` from `test/harness/render-capture.ts`.
- Produces: committed layout goldens picked up by `test/unit/app-shell/golden-captures.test.ts`, which requires a complete narrow/medium/wide triplet per surface.

- [ ] **Step 1: Write the capture harness**

Create `apps/cli/test/harness/capture-playback-error.tsx`:

```tsx
// Captures the failure panel at its SETTLED frame. Reduced motion pins the
// panel to that frame with no clock, so the capture is deterministic and a
// diff in __captures__ means the layout actually moved.
process.env.KUNAI_REDUCED_MOTION = "1";

import { ErrorShell } from "@/app-shell/root-status-shells";
import React from "react";

import { captureSurface } from "./render-capture";

await captureSurface(
  "playback-error",
  <ErrorShell
    message="An unknown error occurred"
    scenario={{ kind: "provider-timeout", providerName: "allmanga", elapsedSec: 12 }}
    waterfall={{
      title: "Source attempts",
      truncated: true,
      rows: [
        { label: "search", detail: "0.4s", status: "succeeded" },
        { label: "scrape", detail: "1.1s", status: "succeeded" },
        { label: "resolve", detail: "timed out", status: "failed" },
      ],
    }}
    onResolve={() => {}}
    onRetry={() => {}}
  />,
);
console.log("captured playback error panel");
process.exit(0);
```

- [ ] **Step 2: Generate the captures**

```bash
bun run --cwd apps/cli test/harness/capture-playback-error.tsx
```

Expected: writes `playback-error.narrow.txt`, `.medium.txt` and `.wide.txt` into `apps/cli/test/__captures__/`.

- [ ] **Step 3: Read the three captures and confirm the layout holds**

```bash
cat apps/cli/test/__captures__/playback-error.narrow.txt
cat apps/cli/test/__captures__/playback-error.wide.txt
```

Check by eye: the rounded border is closed and rectangular in all three; every row starts with the `│` gutter; the resting `❀` sits in the gutter on the last row; no line is ragged or wider than its border. **If the border is ragged, stop** — the panel width is being derived from content somewhere, and Task 4 Step 3 needs fixing before continuing.

- [ ] **Step 4: Run the golden-capture suite**

Run: `bun run --cwd apps/cli test:file test/unit/app-shell/golden-captures.test.ts`
Expected: PASS — the new triplet is non-empty and complete.

- [ ] **Step 5: Verify by hand in a real terminal that input stays responsive**

This is the one risk the automated tests do not discharge. This repo has a known failure mode where a repaint loop's synchronous stdout writes block stdin — the cause of the calendar input-lag bug — and `ErrorShell` owns `r` / Enter / Esc.

```bash
bun run dev -- -S "a-title-that-will-not-resolve"
```

Drive playback to a failure and, **while the petals are still falling**, press `r`. It must respond immediately, not after the fall settles. Also press Esc mid-fall.

If input is sticky: raise `PETAL_STEP_MS` or lower `SPAWN_UNTIL` in `apps/cli/src/app-shell/petal-fall.ts`, then regenerate the captures (Step 2). **Do not keep the current cadence and accept sticky input** — recovery keys on a failure panel take priority over the animation.

- [ ] **Step 6: Update the design-system doc**

In `.docs/design-system.md`, find the section covering state colors and the sakura motif, and add:

```markdown
### Failure motion

The playback failure panel (`ErrorShell`) carries a one-shot sakura petal fall in
the crimson `danger` family: petals drift down the panel for ~5.7s, then the sky
empties and a single still `❀` rests in the gutter beside the recovery actions.

Two rules make it safe to reuse:

- **Petals are written into a cell buffer after text, never inserted into a
  string.** A petal can only overwrite padding, so it cannot reflow a row. See
  `rowCells` in `apps/cli/src/app-shell/root-status-shells.tsx`.
- **The gutter column is a guaranteed lane.** Field lanes yield to text and so
  starve on a narrow terminal; the gutter never carries text, so the effect
  thins to one column instead of vanishing.

Placement is a pure function of frame in
[`apps/cli/src/app-shell/petal-fall.ts`](../apps/cli/src/app-shell/petal-fall.ts).
The clock is `useFrameTick(active, intervalMs, stopAfter)`, which clears its own
interval once the fall settles — a settled surface runs no timer.
```

- [ ] **Step 7: Verify doc paths and formatting**

```bash
bun run verify:doc-paths
bun run fmt
```

Expected: both pass.

- [ ] **Step 8: Run the full test suite**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/cli/test/harness/capture-playback-error.tsx \
        apps/cli/test/__captures__/playback-error.*.txt \
        .docs/design-system.md
git commit -m "test(app-shell): golden captures for the failure panel; document failure motion"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: the motion table and the three load-bearing properties → Task 1; the row model and tone mapping → Task 2; the `stopAfter` clock and the reduced-motion path → Tasks 3 and 4; layout safety → Task 4 (cell buffer, fixed `width`) with assertions in Tasks 1 and 4; degradation → Task 1 (narrow, settled) and Task 4 (reduced motion); testing → Tasks 1, 2, 4, 5; the hand-check risk → Task 5 Step 5. The spec's "no change to `ErrorScenario`, copy or actions" is held by Task 2 reproducing today's strings verbatim.

**One spec item intentionally dropped.** The spec listed a degradation row for `layout-policy` reporting blocked/too-small ("no fall; plain rows"). No task implements it, because `ErrorShell` does not consult `layout-policy` today and the panel is not rendered at all in the blocked state — adding that dependency would be scope the spec did not otherwise justify. The narrow-terminal path is covered by the guaranteed gutter lane instead. Flagging rather than silently dropping.

**Type consistency.** `petalsForFrame` / `settledFrame` / `PETAL_STEP_MS` / `GUTTER_COLUMN` / `PetalPlacement` are named identically in Tasks 1, 4 and their tests. `buildErrorRows` / `rowText` / `ErrorRow` / `ErrorRowTone` match across Tasks 2 and 4. `useFrameTick`'s third parameter is `stopAfter` in Task 3's implementation, test and Task 4's call site. `ErrorRowTone` carries the two extra members (`accent`, `text`) in its definition, its consumer `toneColor`, and the Task 2 test that asserts the accent tone.

**No placeholders.** Every code step contains complete, runnable content.
