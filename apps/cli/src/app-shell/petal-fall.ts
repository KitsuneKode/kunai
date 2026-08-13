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

/**
 * Depth reads as near/mid/far in truecolor. It is carried on the placement
 * rather than left implicit in the color, because `danger` and `dangerDim`
 * both collapse to `"red"` on a 16-color terminal — so a resolved color cannot
 * tell you which depth produced it, and any rule about depth has to be stated
 * in terms of the depth itself.
 */
export type PetalDepth = "near" | "mid" | "far";

/** One petal occupying one cell for one frame. */
export type PetalPlacement = {
  readonly row: number;
  readonly column: number;
  readonly glyph: string;
  readonly color: string;
  readonly depth: PetalDepth;
};

/** Column 0 is the `│` gutter ErrorShell already draws. Text never occupies it. */
export const GUTTER_COLUMN = 0;

/** One row per step. Slow enough to read as drifting rather than scrolling. */
export const PETAL_STEP_MS = 380;

/** No petal is born after this frame (~5.7s), so the sky empties on its own. */
const SPAWN_UNTIL = 15;

/** Text begins at column 2; a field petal needs one more space of clearance. */
const TEXT_CLEARANCE = 1;

type Lane = {
  readonly column: number;
  readonly born: number;
  readonly depth: PetalDepth;
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

function depthColor(depth: PetalDepth): string {
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
    return [
      {
        row: restRow,
        column: GUTTER_COLUMN,
        glyph: STATIC_PETAL,
        color: palette.danger,
        depth: "near",
      },
    ];
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
      depth: lane.depth,
    });
  }

  return placements;
}
