import type { HistoryProgress } from "@kunai/storage";

import {
  projectContinuationState,
  type ContinuationNextRelease,
  type ContinuationProjection,
} from "./continuation-policy";

export class ContinuationProjectionService {
  project(input: {
    readonly titleId: string;
    readonly entries: readonly [string, HistoryProgress][];
    readonly nextRelease?: ContinuationNextRelease | null;
    readonly releaseProgress?: {
      readonly newEpisodeCount: number;
      readonly stale?: boolean;
    } | null;
    readonly offline?: {
      readonly enrolled: boolean;
      readonly readyNextEpisodes: readonly {
        readonly season: number;
        readonly episode: number;
        readonly jobId?: string;
      }[];
    } | null;
  }): ContinuationProjection {
    return projectContinuationState(input);
  }
}
