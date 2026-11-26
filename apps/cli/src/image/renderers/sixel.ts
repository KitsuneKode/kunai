import { getTerminalCellPixels } from "../cell-size";

/**
 * Keep the original 10×20 pixel estimate for terminals that do not report
 * their cell geometry.
 */
const CELL_WIDTH_PX = 10;
const CELL_HEIGHT_PX = 20;

/**
 * How many columns equal one row in pixels.
 *
 * A terminal cell is about twice as tall as it is wide, so a slot sized with
 * equal rows and columns is not square — it is a tall rectangle, and a square
 * image placed in it fits to the width and leaves the rest of the reserved rows
 * empty underneath. Callers laying out square art need this to size the slot.
 */
export const CELL_ASPECT = CELL_HEIGHT_PX / CELL_WIDTH_PX;

/** Pixel budget for a poster sized in terminal cells. */
export function pixelBudgetForCells(columns: number, rows: number) {
  const size = getTerminalCellPixels();
  return {
    maxWidth: columns * (size?.width ?? CELL_WIDTH_PX),
    maxHeight: rows * (size?.height ?? CELL_HEIGHT_PX),
  };
}
