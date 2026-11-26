export type CellPixels = { readonly width: number; readonly height: number };

export const CELL_PIXEL_SIZE_QUERIES = "\x1b[16t\x1b[14t";

let cellPixels: CellPixels | null = null;
const listeners = new Set<() => void>();

export function getTerminalCellPixels(): CellPixels | null {
  return cellPixels;
}

export function setTerminalCellPixels(size: CellPixels | null): void {
  if (cellPixels?.width === size?.width && cellPixels?.height === size?.height) return;
  cellPixels = size;
  for (const listener of listeners) listener();
}

export function subscribeTerminalCellPixels(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** CSI 6 reports a cell; CSI 4 reports the text area's pixel dimensions. */
export function cellPixelsFromReport(
  report: string,
  columns: number,
  rows: number,
): CellPixels | null {
  const [kind, y, x] = report.slice(2, -1).split(";");
  const width = Math.floor(Number(x) / (kind === "4" ? columns : 1));
  const height = Math.floor(Number(y) / (kind === "4" ? rows : 1));
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 256 ||
    height > 256
  )
    return null;
  return { width, height };
}
