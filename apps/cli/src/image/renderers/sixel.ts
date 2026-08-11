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
