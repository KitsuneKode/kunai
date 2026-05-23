import type { EpisodeCursor } from "@/domain/media/episode-cursor";
import type { MediaKind, ProviderExternalIds } from "@kunai/types";

export type ReleaseReconciliationTrigger =
  | "startup"
  | "browse-idle"
  | "history"
  | "calendar"
  | "post-playback";

export type ReleaseReconciliationSource = "anilist" | "tmdb";

export type ReleaseReconciliationHistoryRow = EpisodeCursor & {
  readonly titleId: string;
  readonly mediaKind: MediaKind;
  readonly title: string;
  readonly completed: boolean;
  readonly externalIds?: ProviderExternalIds;
  readonly updatedAt: string;
};

export type ReleaseReconciliationCandidate = EpisodeCursor & {
  readonly titleId: string;
  readonly mediaKind: "series" | "anime";
  readonly source: ReleaseReconciliationSource;
  readonly catalogId: string;
  readonly title: string;
  readonly anchorSeason?: number;
  readonly anchorEpisode: number;
};

export type ReleaseReconciliationSkipReason =
  | "movie"
  | "missing-catalog-id"
  | "muted"
  | "not-due"
  | "no-normal-episode"
  | "budget-exhausted";

export type ReleaseReconciliationSkip = {
  readonly titleId: string;
  readonly reason: ReleaseReconciliationSkipReason;
};

export type ExistingReleaseProjection = {
  readonly titleId: string;
  readonly nextCheckAt: string;
};
