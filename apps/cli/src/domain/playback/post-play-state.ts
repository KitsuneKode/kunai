export type PostPlayInput = {
  readonly hasNextEpisode: boolean;
  readonly isSeasonFinale: boolean;
  readonly isSeriesComplete: boolean;
  readonly isCaughtUpOnAiring: boolean;
  readonly hasNextSeason?: boolean;
  readonly nextAirDate?: string;
  /**
   * Whether playback meaningfully started. When false (e.g. mpv exited on load
   * or the user quit within the first few seconds), the session is NOT a
   * completion — never claim "finished" or mark watched. Defaults to true so
   * existing callers keep their completion semantics.
   */
  readonly playbackStarted?: boolean;
};

export type PostPlayState =
  | { kind: "did-not-start" }
  | { kind: "mid-series" }
  | { kind: "caught-up"; nextAirDate?: string }
  | { kind: "season-finale"; hasNextSeason: boolean }
  | { kind: "series-complete" };

export function resolvePostPlayState(input: PostPlayInput): PostPlayState {
  if (input.playbackStarted === false) {
    return { kind: "did-not-start" };
  }
  if (input.isSeriesComplete) {
    return { kind: "series-complete" };
  }
  if (input.isCaughtUpOnAiring) {
    return { kind: "caught-up", nextAirDate: input.nextAirDate };
  }
  if (input.isSeasonFinale) {
    return { kind: "season-finale", hasNextSeason: input.hasNextSeason ?? false };
  }
  return { kind: "mid-series" };
}
