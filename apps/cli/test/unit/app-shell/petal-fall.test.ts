import { describe, expect, test } from "bun:test";

import { GUTTER_COLUMN, PETAL_STEP_MS, petalsForFrame, settledFrame } from "@/app-shell/petal-fall";
import { BLOOM_FRAMES, STATIC_PETAL } from "@/app-shell/primitives/SakuraPetal";
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

  // Asserted on DEPTH, not on the resolved color. `danger` and `dangerDim` both
  // collapse to "red" on a 16-color terminal, so a color comparison here passes
  // on a truecolor dev machine and fails in CI for a reason that has nothing to
  // do with the rule being checked.
  test("no gutter petal uses the mid depth, which would vanish against the idle gutter", () => {
    for (let frame = 0; frame <= settledFrame(ROW_COUNT); frame++) {
      for (const petal of petalsForFrame({
        frame,
        rowCount: ROW_COUNT,
        rowEndColumns: rowEnds(),
        width: 76,
      })) {
        if (petal.column === GUTTER_COLUMN) {
          expect(petal.depth).not.toBe("mid");
        }
      }
    }
  });

  test("each depth maps to its own token, and the gutter never draws the gutter's own color", () => {
    const seen = new Map<string, string>();
    for (let frame = 0; frame <= settledFrame(ROW_COUNT); frame++) {
      for (const petal of petalsForFrame({
        frame,
        rowCount: ROW_COUNT,
        rowEndColumns: rowEnds(),
        width: 76,
      })) {
        seen.set(petal.depth, petal.color);
      }
    }
    expect(seen.get("near")).toBe(palette.danger);
    expect(seen.get("mid")).toBe(palette.dangerDim);
    expect(seen.get("far")).toBe(palette.accentDim);
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
      {
        row: ROW_COUNT - 1,
        column: GUTTER_COLUMN,
        glyph: STATIC_PETAL,
        color: palette.danger,
        depth: "near",
      },
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
