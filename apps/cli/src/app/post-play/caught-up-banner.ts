// caught-up-banner.ts — pure formatter for the anime "caught up" post-play banner.
//
// When an anime title has no next episode yet but the catalog schedule cache
// knows the next air date, the post-play surface upgrades the generic "caught
// up" banner with a precise countdown ("airs in 3h 20m", "airs on Tuesday",
// "airs Mar 4"). The date math lived inline in PlaybackPhase.execute; it is a
// pure transform of (episode, releaseAt, now) and is extracted here so it can
// be unit-tested without a running playback session.

export type CaughtUpReleaseBannerInput = {
  /** Next episode number from the schedule cache; absent disables the banner. */
  readonly episode: number | null | undefined;
  /** ISO timestamp of the next release; absent or unparseable disables the banner. */
  readonly releaseAt: string | null | undefined;
  /** Reference "now" in epoch milliseconds (injected for deterministic tests). */
  readonly now: number;
};

const HOUR_MS = 3_600_000;
const HOURS_PER_DAY = 24;
const HOURS_PER_WEEK = 168;

/**
 * Formats the precise "Caught up · Ep N airs …" banner, or returns null when
 * the schedule is missing, unparseable, or already in the past (the caller
 * falls back to the generic catalog hint in those cases).
 */
export function formatCaughtUpReleaseBanner(input: CaughtUpReleaseBannerInput): string | null {
  if (!input.episode || !input.releaseAt) return null;
  const releaseMs = Date.parse(input.releaseAt);
  if (!Number.isFinite(releaseMs) || releaseMs <= input.now) return null;

  const diffHours = (releaseMs - input.now) / HOUR_MS;
  let timeLabel: string;
  if (diffHours < HOURS_PER_DAY) {
    const hours = Math.floor(diffHours);
    const minutes = Math.floor((diffHours - hours) * 60);
    timeLabel = hours > 0 ? `in ${hours}h ${minutes}m` : `in ${minutes}m`;
  } else if (diffHours < HOURS_PER_WEEK) {
    timeLabel = `on ${new Date(releaseMs).toLocaleDateString(undefined, { weekday: "long" })}`;
  } else {
    timeLabel = new Date(releaseMs).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  return `Caught up · Ep ${input.episode} airs ${timeLabel}`;
}
