import { debugImage } from "../debug";
import { renderSixelFromBytes } from "../sixel";
import type { ImageRenderOptions } from "../types";
import { parseSizeSpec } from "./half-block";

/**
 * Terminal cell geometry, in pixels, used to turn a size given in cells into a
 * pixel budget for the encoder.
 *
 * Sixel is addressed in pixels, but every caller here sizes posters in cells, so
 * something has to bridge the two. A cell is close to 10x20 on the default fonts
 * of the terminals that implement sixel (Windows Terminal's Cascadia Mono,
 * WezTerm's JetBrains Mono, foot's monospace default). Being slightly wrong
 * costs a little margin; being wildly wrong overflows the reserved rows and
 * pushes the layout, so this errs on the small side.
 *
 * chafa has the same problem and guesses 8x20 when its stdout is a pipe -- which
 * ours always was -- so this is not a regression against it.
 */
const CELL_WIDTH_PX = 10;
const CELL_HEIGHT_PX = 20;

const runtime = {
  readFile: (filePath: string): Promise<ArrayBuffer> => Bun.file(filePath).arrayBuffer(),
  write: (text: string): void => {
    process.stdout.write(text);
  },
};

/** Pixel budget for a poster sized in terminal cells. */
export function pixelBudgetForCells(
  columns: number,
  rows: number,
): {
  maxWidth: number;
  maxHeight: number;
} {
  return { maxWidth: columns * CELL_WIDTH_PX, maxHeight: rows * CELL_HEIGHT_PX };
}

/**
 * Paint a poster as sixel, in process.
 *
 * Needs no `chafa` on PATH: the encoder is ours. That matters most on Windows,
 * where chafa is effectively never installed and its absence silently demoted
 * sixel-capable terminals to the two-pixels-per-cell half-block fallback.
 */
export async function renderSixel(filePath: string, options: ImageRenderOptions): Promise<void> {
  const spec = parseSizeSpec(options.size) ?? { columns: 30, rows: options.maxRows };
  const rows = Math.max(1, Math.min(spec.rows, options.maxRows));
  const bytes = new Uint8Array(await runtime.readFile(filePath));

  const sixel = renderSixelFromBytes(bytes, pixelBudgetForCells(spec.columns, rows));
  if (!sixel) {
    debugImage("sixel: poster could not be decoded");
    throw new Error("poster could not be decoded for sixel output");
  }

  runtime.write(`${sixel}\n`);
}

export const __testing = {
  runtime,
  CELL_WIDTH_PX,
  CELL_HEIGHT_PX,
};
