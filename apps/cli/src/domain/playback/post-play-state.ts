export type PostPlayInput = {
  readonly hasNextEpisode: boolean;
  readonly isSeasonFinale: boolean;
  readonly isSeriesComplete: boolean;
  readonly isCaughtUpOnAiring: boolean;
  readonly hasNextSeason?: boolean;
  readonly nextAirDate?: string;
};

export type PostPlayState =
  | { kind: "mid-series" }
  | { kind: "caught-up"; nextAirDate?: string }
  | { kind: "season-finale"; hasNextSeason: boolean }
  | { kind: "series-complete" };

export function resolvePostPlayState(input: PostPlayInput): PostPlayState {
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
