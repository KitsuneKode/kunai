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

function trimTrailingZeros(val: string): string {
  return val.replace(/\.0$/, "");
}

export function formatViewCount(count: number | undefined | null): string | undefined {
  if (count === undefined || count === null || !Number.isFinite(count) || count < 0) {
    return undefined;
  }
  if (count >= 1_000_000_000)
    return `${trimTrailingZeros((count / 1_000_000_000).toFixed(1))}B views`;
  if (count >= 1_000_000) return `${trimTrailingZeros((count / 1_000_000).toFixed(1))}M views`;
  if (count >= 1_000) return `${trimTrailingZeros((count / 1_000).toFixed(1))}K views`;
  return `${count} views`;
}

export function formatRelativeTime(
  iso: string | undefined | null,
  now: number = Date.now(),
): string | undefined {
  if (!iso) return undefined;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return undefined;
  const ms = now - then;
  if (ms < 0) return undefined;
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
