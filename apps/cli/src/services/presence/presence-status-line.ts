import type { PresenceStatus } from "./PresenceService";

/**
 * How a presence snapshot reads on a status surface.
 *
 * `PresenceSnapshot.detail` is deliberately self-describing: for an unavailable
 * provider it already leads with the status word, so the settings status row —
 * which renders `detail` on its own — still says what happened. Every other
 * surface prefixes the status itself, and so printed it twice:
 *
 *     Discord presence · unavailable · unavailable · Could not connect to…
 *
 * Four surfaces composed that line by hand and all four repeated it. This is the
 * presence-side twin of `formatHealthRowDetail`, shared rather than fixed in
 * place so a fifth surface cannot reintroduce the same duplication.
 *
 * Segments are compared case-insensitively after trimming, and only a leading
 * restatement is dropped — a reason that legitimately mentions the status later
 * ("unavailable · retrying in 5s · still unavailable") keeps every segment.
 */
export function presenceStatusDetail(
  status: PresenceStatus,
  detail: string,
  separator = "  ·  ",
): string {
  const segments = detail
    .split("·")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) return status;
  if (segments[0]?.toLowerCase() === status.toLowerCase()) return segments.join(separator);
  return [status, ...segments].join(separator);
}
