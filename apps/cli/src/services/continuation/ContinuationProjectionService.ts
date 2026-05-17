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
  }): ContinuationProjection {
    return projectContinuationState(input);
  }
}
