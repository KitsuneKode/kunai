import type { EpisodeInfo, PlaybackTimingMetadata, TitleInfo } from "@/domain/types";

export type TimingContentMode = "series" | "anime" | "movie";

export type PlaybackTimingOutcomeClass =
  | "not-applicable"
  | "identity-missing"
  | "not-found"
  | "timeout"
  | "offline"
  | "http-error"
  | "cancelled";

export interface PlaybackTimingSourceOutcome {
  readonly source: string;
  readonly failureClass: PlaybackTimingOutcomeClass | null;
  readonly durationMs?: number;
}

export interface PlaybackTimingSourceFetchResult {
  readonly metadata: PlaybackTimingMetadata | null;
  readonly failureClass: PlaybackTimingOutcomeClass | null;
}

export interface PlaybackTimingAggregatorOptions {
  readonly sourceDeadlineMs?: number;
  readonly aggregateDeadlineMs?: number;
  readonly now?: () => number;
}

/** Optional hints for timing sources (e.g. MAL resolution for AniSkip per catalog provider). */
export interface PlaybackTimingFetchContext extends PlaybackTimingAggregatorOptions {
  /** Active provider when timing is resolved (e.g. `allanime` for AllAnime GraphQL `malId`). */
  readonly providerId?: string;
  /** Content mode from the aggregator — gates proven TMDB identity for IntroDB. */
  readonly mode?: TimingContentMode;
  readonly onSourceOutcome?: (outcome: PlaybackTimingSourceOutcome) => void;
  /** Caller signal — used to distinguish timeout vs cancelled when a child aborts. */
  readonly parentSignal?: AbortSignal;
}

export interface PlaybackTimingSource {
  readonly name: string;
  canHandle(title: TitleInfo, mode: TimingContentMode): boolean;
  fetch(opts: {
    title: TitleInfo;
    episode: EpisodeInfo;
    signal?: AbortSignal;
    context?: PlaybackTimingFetchContext;
  }): Promise<PlaybackTimingMetadata | null>;
  fetchDetailed?(opts: {
    title: TitleInfo;
    episode: EpisodeInfo;
    signal?: AbortSignal;
    context?: PlaybackTimingFetchContext;
  }): Promise<PlaybackTimingSourceFetchResult>;
}

const OFFLINE_PATTERNS = [
  "enotfound",
  "eai_again",
  "enetunreach",
  "network is unreachable",
  "err_internet_disconnected",
  "err_name_not_resolved",
] as const;

export function isTimingAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  return name === "AbortError" || name === "TimeoutError";
}

export function isTimingOfflineError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  return OFFLINE_PATTERNS.some((pattern) => lower.includes(pattern));
}

export function classifyTimingHttpStatus(status: number): PlaybackTimingOutcomeClass {
  if (status === 404) return "not-found";
  return "http-error";
}

export function classifyTimingThrownError(
  error: unknown,
  opts?: {
    readonly parentSignal?: AbortSignal;
  },
): PlaybackTimingOutcomeClass {
  if (isTimingAbortError(error)) {
    return opts?.parentSignal?.aborted ? "cancelled" : "timeout";
  }
  if (isTimingOfflineError(error)) return "offline";
  return "http-error";
}
