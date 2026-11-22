/**
 * What one finished or partly watched episode is allowed to change on AniList.
 *
 * A `progress:set` operation describes one episode: its number and whether the
 * viewer finished it. AniList's list status describes the whole title. The two
 * are not the same fact, so the write is decided against the remote entry and
 * the title's episode count instead of being copied across:
 *
 * - The title is `COMPLETED` only when the finished episode is its last one.
 *   Finishing episode 3 of 12 is progress, not completion.
 * - A title already `COMPLETED` on AniList is left alone. Re-watching an early
 *   episode must not demote it to `CURRENT` or wind its progress back; marking a
 *   rewatch is the user's call (`REPEATING`), not an inference from playback.
 * - A `REPEATING` entry keeps that status while its progress moves forward, and
 *   becomes `COMPLETED` when the rewatch reaches the last episode.
 * - Progress never moves backward. A remote entry already at or past this
 *   episode is not rewritten unless this write completes the title.
 */
export type AniListListStatus =
  | "CURRENT"
  | "PLANNING"
  | "COMPLETED"
  | "DROPPED"
  | "PAUSED"
  | "REPEATING";

export type AniListProgressDecision =
  | { readonly write: false; readonly reason: "remote-completed" | "remote-ahead" }
  | {
      readonly write: true;
      readonly status: "CURRENT" | "COMPLETED" | "REPEATING";
      readonly progress: number;
    };

export function decideAniListProgressWrite(input: {
  /** The episode this operation reports, 1-based and cour-relative. */
  readonly progress: number;
  /** True when the viewer finished that episode. */
  readonly episodeFinished: boolean;
  /** AniList's episode count, or null while unknown (still airing, unannounced). */
  readonly totalEpisodes: number | null;
  /** The viewer's current list entry, or null when the title is not on their list. */
  readonly remote: { readonly status: AniListListStatus | null; readonly progress: number } | null;
}): AniListProgressDecision {
  const { progress, episodeFinished, totalEpisodes, remote } = input;
  const finishesTitle =
    episodeFinished && totalEpisodes !== null && totalEpisodes > 0 && progress >= totalEpisodes;

  if (remote?.status === "COMPLETED") return { write: false, reason: "remote-completed" };

  if (remote && remote.progress >= progress && !finishesTitle) {
    return { write: false, reason: "remote-ahead" };
  }

  const status = finishesTitle
    ? "COMPLETED"
    : remote?.status === "REPEATING"
      ? "REPEATING"
      : "CURRENT";
  return { write: true, status, progress: Math.max(progress, remote?.progress ?? 0) };
}
