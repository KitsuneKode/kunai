/** Format seconds as `H:MM:SS` or `M:SS` for browse labels. */
export function formatDurationSeconds(totalSeconds: number | undefined | null): string | undefined {
  if (totalSeconds === undefined || totalSeconds === null || !Number.isFinite(totalSeconds)) {
    return undefined;
  }
  const seconds = Math.max(0, Math.trunc(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatViewCount(count: number | undefined | null): string | undefined {
  if (count === undefined || count === null || !Number.isFinite(count) || count < 0) {
    return undefined;
  }
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B views`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M views`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K views`;
  return `${count} views`;
}
