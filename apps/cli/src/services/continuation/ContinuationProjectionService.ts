import type { HistoryEntry } from "@/services/persistence/HistoryStore";

import {
  projectContinuationState,
  type ContinuationNextRelease,
  type ContinuationProjection,
} from "./continuation-policy";

export class ContinuationProjectionService {
  project(input: {
    readonly titleId: string;
    readonly entries: readonly [string, HistoryEntry][];
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
