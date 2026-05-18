import type { ProviderId, ProviderTraceEvent, StreamPresentation } from "./index";

export type ProviderCycleFailureClass =
  | "candidate-timeout"
  | "candidate-network"
  | "candidate-empty"
  | "candidate-expired"
  | "candidate-blocked"
  | "candidate-parse"
  | "candidate-unsupported"
  | "candidate-user-cancelled"
  | "candidate-unknown";

export type ProviderCycleIntent =
  | "automatic"
  | "manual-source"
  | "skip-retry"
  | "skip-source"
  | "fallback-provider"
  | "cancel";

export type ProviderCycleStopReason = "resolved" | "exhausted" | "fallback-requested" | "cancelled";

export interface ProviderCycleCandidate {
  readonly id: string;
  readonly providerId: ProviderId;
  readonly sourceId?: string;
  readonly serverId?: string;
  readonly variantId?: string;
  readonly streamId?: string;
  readonly groupId?: string;
  readonly label?: string;
  readonly nativeLabel?: string;
  readonly normalizedAudioLanguage?: string;
  readonly normalizedSubtitleLanguage?: string;
  readonly presentation?: StreamPresentation;
  readonly qualityRank?: number;
  readonly priority: number;
  readonly metadata?: Record<string, unknown>;
}

export interface ProviderCycleFailure {
  readonly providerId: ProviderId;
  readonly candidateId: string;
  readonly failureClass: ProviderCycleFailureClass;
  readonly message: string;
  readonly retryable: boolean;
  readonly at: string;
}

export interface ProviderCycleAttempt {
  readonly candidate: ProviderCycleCandidate;
  readonly attempt: number;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly failure?: ProviderCycleFailure;
}

export interface ProviderCycleResult<TResolved> {
  readonly selected?: TResolved;
  readonly selectedCandidate?: ProviderCycleCandidate;
  readonly attempts: readonly ProviderCycleAttempt[];
  readonly events: readonly ProviderTraceEvent[];
  readonly stopReason: ProviderCycleStopReason;
  readonly fallbackRequested: boolean;
  readonly cancelled: boolean;
}
