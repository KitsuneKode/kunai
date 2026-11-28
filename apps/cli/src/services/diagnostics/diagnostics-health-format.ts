export const NO_ACTION_LABEL = "No action needed";

export function formatHealthRowDetail(row: {
  readonly label: string;
  readonly reason: string;
  readonly recommendedActionLabel: string;
}): string {
  const segments = [row.label, row.reason, row.recommendedActionLabel];
  const meaningful: string[] = [];
  for (const segment of segments) {
    const trimmed = segment?.trim();
    if (!trimmed || trimmed === NO_ACTION_LABEL) continue;
    if (meaningful.some((seen) => seen.toLowerCase() === trimmed.toLowerCase())) continue;
    meaningful.push(trimmed);
  }
  return meaningful.join("  ·  ");
}
