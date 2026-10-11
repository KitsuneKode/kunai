const MINUTE_MS = 60_000;

/**
 * How long ago `at` was, on the one scale every history surface shares.
 *
 * Undefined for an unparseable or future timestamp — the caller decides what
 * to show instead. `now` is injectable so renders are reproducible.
 */
export function formatRelativeAge(
  at: string | number | Date,
  now: number = Date.now(),
): string | undefined {
  const ms = now - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const minutes = Math.floor(ms / MINUTE_MS);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 35) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
