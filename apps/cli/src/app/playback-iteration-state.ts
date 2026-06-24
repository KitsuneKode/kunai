import type { PlaybackSessionState } from "@/app/playback-session-controller";
import type { EpisodeInfo } from "@/domain/types";

/** Per-iteration playback intent carried explicitly through the loop. */
export type PlaybackIterationState = {
  readonly titleId: string;
  readonly episode: EpisodeInfo;
  readonly session: PlaybackSessionState;
  readonly providerId: string;
  readonly sourceProvenance: "local" | "online" | "cache" | "prefetched" | "unknown";
  readonly localJobId: string | null;
};

export function createPlaybackIterationState(input: {
  readonly titleId: string;
  readonly episode: EpisodeInfo;
  readonly session: PlaybackSessionState;
  readonly providerId: string;
  readonly sourceProvenance?: PlaybackIterationState["sourceProvenance"];
  readonly localJobId?: string | null;
}): PlaybackIterationState {
  return {
    titleId: input.titleId,
    episode: input.episode,
    session: input.session,
    providerId: input.providerId,
    sourceProvenance: input.sourceProvenance ?? "unknown",
    localJobId: input.localJobId ?? null,
  };
}
