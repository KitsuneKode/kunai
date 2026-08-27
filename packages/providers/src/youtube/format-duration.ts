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

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
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
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return plural(days, "day");
  if (days < 30) return plural(Math.floor(days / 7), "week");
  // Each rung divides the *same* unit it compares against, so no span falls
  // between two rungs. Mixing 30-day months with 365-day years left days 360-364
  // matching neither, and they rendered as "0 years ago".
  const months = Math.floor(days / 30);
  if (months < 12) return plural(months, "month");
  return plural(Math.floor(months / 12), "year");
}
