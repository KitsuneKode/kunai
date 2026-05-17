export type TitleAttentionPreference = "implicit" | "following" | "muted";

export interface NewEpisodeTrackingInput {
  readonly preference: TitleAttentionPreference;
  readonly recentWatchedEpisodes: number;
  readonly lastWatchedAt?: string;
  readonly now: string;
  readonly recentWindowMs?: number;
}

export function shouldTrackTitleForNewEpisodes(input: NewEpisodeTrackingInput): {
  readonly shelf: boolean;
  readonly notification: boolean;
} {
  if (input.preference === "muted") {
    return { shelf: false, notification: false };
  }
  if (input.preference === "following") {
    return { shelf: true, notification: true };
  }

  const recentWindowMs = input.recentWindowMs ?? 14 * 24 * 60 * 60 * 1000;
  const watchedRecently =
    input.lastWatchedAt !== undefined &&
    Date.parse(input.now) - Date.parse(input.lastWatchedAt) <= recentWindowMs;
  const strongInterest = input.recentWatchedEpisodes >= 2 || watchedRecently;
  return {
    shelf: strongInterest,
    notification: strongInterest,
  };
}
