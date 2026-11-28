import { measureColumns } from "./shell-text";

/**
 * Columns a footer-style row may use. The narrow footer and the Now Playing
 * GO strip share this budget (`width - 2`, never below 18) so a second
 * breakpoint ladder cannot drift from the footer.
 */
export function footerRowBudget(terminalWidth: number): number {
  return Math.max(18, terminalWidth - 2);
}

/**
 * Highest-priority prefix that fits `budget`. Later items are the ones dropped.
 * The gap is the rendered separator, measured the same way footer chips are.
 */
export function fitTextItemsOnOneLine(
  items: readonly string[],
  budget: number,
  separator = " · ",
): readonly string[] {
  const gap = measureColumns(separator);
  const kept: string[] = [];
  let used = 0;
  for (const item of items) {
    const columns = measureColumns(item);
    const next = used + (kept.length > 0 ? gap : 0) + columns;
    if (kept.length > 0 && next > budget) break;
    kept.push(item);
    used = kept.length === 1 ? columns : next;
  }
  return kept;
}
