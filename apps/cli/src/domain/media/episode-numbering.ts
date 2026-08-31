/**
 * The one rule for "these two records mean the same episode".
 *
 * Anime arrives numbered two ways. Absolute-numbered sources carry no season
 * and put the number in `absoluteEpisode`; season-relative sources carry
 * `season` + `episode`, and a history row for the same playback may carry both.
 * Every comparison that normalized one side only — `(entry.season ?? 1) ===
 * job.season`, or `left.absoluteEpisode === right.absoluteEpisode` when a
 * single side had an absolute number — compared a number against `undefined`
 * and matched nothing, silently.
 */
export type EpisodeNumbering = {
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
};

export function sameEpisodeNumbering(left: EpisodeNumbering, right: EpisodeNumbering): boolean {
  // Absolute numbers are authoritative, but only when both sides carry one:
  // an absolute number on its own says nothing about the other side's season.
  if (left.absoluteEpisode !== undefined && right.absoluteEpisode !== undefined) {
    return left.absoluteEpisode === right.absoluteEpisode;
  }
  return (
    (left.season ?? 1) === (right.season ?? 1) &&
    (left.episode ?? left.absoluteEpisode ?? 1) === (right.episode ?? right.absoluteEpisode ?? 1)
  );
}
