/** Maps a value to a 0..4 ramp index. Any positive activity is at least 1. */
export function heatBucket(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  const ratio = Math.min(1, value / max);
  return Math.max(1, Math.ceil(ratio * 4));
}

/** Keeps only the most recent `months` entries so the heatmap stays bounded. */
export function boundHeatWindow<T>(entries: readonly T[], months: number): T[] {
  if (months <= 0) return [];
  if (entries.length <= months) return [...entries];
  return entries.slice(entries.length - months);
}
