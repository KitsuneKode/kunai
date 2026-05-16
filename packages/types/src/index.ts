export type MediaKind = "movie" | "series" | "anime";

export type ProviderId = string & { readonly __brand?: "ProviderId" };

export type ProviderRuntime = "browser-safe-fetch" | "direct-http" | "debrid";

export type ProviderCapability =
  | "search"
  | "episode-list"
  | "source-resolve"
  | "subtitle-resolve"
  | "multi-source"
  | "quality-ranked"
  | "debrid-lookup";

export type ProviderOperation =
  | "search"
  | "list-episodes"
  | "resolve-stream"
  | "resolve-subtitles"
  | "refresh-source"
  | "health-check";

export type CacheTtlClass =
  | "never-cache"
  | "session"
  | "stream-manifest"
  | "direct-media-url"
  | "subtitle-list"
  | "episode-list"
  | "catalog-static"
  | "catalog-trending"
  | "provider-health";

export type StreamPresentation = "sub" | "dub" | "raw";

export type SubtitleDelivery = "hardcoded" | "embedded" | "external";

export interface CachePolicy {
  readonly ttlClass: CacheTtlClass;
  readonly ttlMs?: number;
  readonly staleWhileRevalidateMs?: number;
  readonly scope: "memory" | "local" | "browser" | "edge-metadata" | "account-sync";
  readonly keyParts: readonly string[];
  readonly allowStale?: boolean;
}

export interface TitleIdentity {
  readonly id: string;
  readonly kind: MediaKind;
  readonly title: string;
  readonly year?: number;
  readonly anilistId?: string;
  readonly tmdbId?: string;
  readonly imdbId?: string;
  readonly malId?: string;
}

export interface EpisodeIdentity {
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly title?: string;
  readonly airDate?: string;
}

export interface StreamCandidate {
  readonly id: string;
  readonly providerId: ProviderId;
  readonly sourceId?: string;
  readonly variantId?: string;
  readonly url?: string;
  readonly deferredLocator?: string;
  readonly protocol: "hls" | "dash" | "mp4" | "iframe" | "unknown";
  readonly container?: "m3u8" | "mpd" | "mp4" | "webm" | "unknown";
  readonly audioLanguages?: readonly string[];
  readonly presentation?: StreamPresentation;
  readonly hardSubLanguage?: string;
  readonly subtitleDelivery?: SubtitleDelivery;
  readonly subtitleLanguages?: readonly string[];
  readonly flavorArchetype?: string;
  readonly flavorLabel?: string;
  readonly serverName?: string;
  readonly qualityLabel?: string;
  readonly qualityRank?: number;
  readonly headers?: Record<string, string>;
  readonly expiresAt?: string;
  readonly confidence: number;
  readonly cachePolicy: CachePolicy;
  readonly metadata?: Record<string, unknown>;
}

export interface SubtitleCandidate {
  readonly id: string;
  readonly providerId: ProviderId;
  readonly sourceId?: string;
  readonly variantId?: string;
  readonly url: string;
  readonly language?: string;
  readonly label?: string;
  readonly format?: "srt" | "vtt" | "ass" | "unknown";
  readonly source: "provider" | "wyzie" | "manual" | "embedded" | "unknown";
  readonly confidence: number;
  readonly syncEvidence?: string;
  readonly cachePolicy: CachePolicy;
}

export type ProviderSourceKind =
  | "provider-api"
  | "embed"
  | "file-host"
  | "mirror"
  | "manifest"
  | "direct-media"
  | "unknown";

export type ProviderSourceStatus =
  | "pending"
  | "probing"
  | "available"
  | "selected"
  | "skipped"
  | "failed"
  | "exhausted";

export interface ProviderSourceCandidate {
  readonly id: string;
  readonly providerId: ProviderId;
  readonly kind: ProviderSourceKind;
  readonly label?: string;
  readonly host?: string;
  readonly status: ProviderSourceStatus;
  readonly confidence: number;
  readonly requiresRuntime?: ProviderRuntime;
  readonly cachePolicy?: CachePolicy;
  readonly metadata?: Record<string, unknown>;
}

export interface ProviderVariantCandidate {
  readonly id: string;
  readonly providerId: ProviderId;
  readonly sourceId: string;
  readonly label?: string;
  readonly qualityLabel?: string;
  readonly qualityRank?: number;
  readonly protocol?: StreamCandidate["protocol"];
  readonly container?: StreamCandidate["container"];
  readonly audioLanguages?: readonly string[];
  readonly presentation?: StreamPresentation;
  readonly hardSubLanguage?: string;
  readonly subtitleDelivery?: SubtitleDelivery;
  readonly subtitleLanguages?: readonly string[];
  readonly flavorArchetype?: string;
  readonly flavorLabel?: string;
  readonly streamIds?: readonly string[];
  readonly subtitleIds?: readonly string[];
  readonly selected?: boolean;
  readonly confidence: number;
  readonly metadata?: Record<string, unknown>;
}

export type ResolveErrorCode =
  | "provider-unavailable"
  | "unsupported-title"
  | "not-found"
  | "network-error"
  | "rate-limited"
  | "blocked"
  | "expired"
  | "parse-failed"
  | "runtime-missing"
  | "timeout"
  | "cancelled"
  | "unknown";

export interface ProviderFailure {
  readonly providerId: ProviderId;
  readonly code: ResolveErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly at: string;
}

export interface ResolveTraceStep {
  readonly at: string;
  readonly stage: "cache" | "provider" | "runtime" | "subtitle" | "fallback" | "player" | "health";
  readonly message: string;
  readonly providerId?: ProviderId;
  readonly durationMs?: number;
  readonly attributes?: Record<string, string | number | boolean | null>;
}

export type ProviderTraceEventType =
  | "provider:start"
  | "provider:success"
  | "provider:exhausted"
  | "source:start"
  | "source:success"
  | "source:failed"
  | "source:skipped"
  | "variant:discovered"
  | "variant:selected"
  | "subtitle:discovered"
  | "subtitle:selected"
  | "cache:hit"
  | "cache:stale"
  | "cache:miss"
  | "runtime:requested"
  | "runtime:started"
  | "runtime:reused"
  | "runtime:released"
  | "retry:scheduled"
  | "retry:aborted";

export interface ProviderTraceEvent {
  readonly type: ProviderTraceEventType;
  readonly at: string;
  readonly providerId: ProviderId;
  readonly sourceId?: string;
  readonly variantId?: string;
  readonly streamId?: string;
  readonly subtitleId?: string;
  readonly attempt?: number;
  readonly message: string;
  readonly durationMs?: number;
  readonly attributes?: Record<string, string | number | boolean | null>;
}

export interface ResolveTrace {
  readonly id: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly title: TitleIdentity;
  readonly episode?: EpisodeIdentity;
  readonly selectedProviderId?: ProviderId;
  readonly selectedStreamId?: string;
  readonly cacheHit: boolean;
  readonly runtime?: ProviderRuntime;
  readonly steps: readonly ResolveTraceStep[];
  readonly events?: readonly ProviderTraceEvent[];
  readonly failures: readonly ProviderFailure[];
}

export interface ProviderHealth {
  readonly providerId: ProviderId;
  readonly status: "healthy" | "degraded" | "down" | "unknown";
  readonly checkedAt: string;
  readonly medianResolveMs?: number;
  readonly recentFailureRate?: number;
  readonly consecutiveFailures?: number;
  readonly subtitleSuccessRate?: number;
  readonly streamSurvivalRate?: number;
}

export interface ProviderHealthDelta {
  readonly providerId: ProviderId;
  readonly outcome: "success" | "failure" | "timeout" | "blocked" | "stalled";
  readonly resolveMs?: number;
  readonly at: string;
}

export interface ProviderRuntimePort {
  readonly runtime: ProviderRuntime;
  readonly operations: readonly ProviderOperation[];
  readonly browserSafe: boolean;
  readonly relaySafe: boolean;
  readonly localOnly: boolean;
}

export interface ProviderResolveInput {
  readonly title: TitleIdentity;
  readonly episode?: EpisodeIdentity;
  readonly mediaKind: MediaKind;
  readonly preferredAudioLanguage?: string;
  readonly preferredSubtitleLanguage?: string;
  readonly preferredPresentation?: StreamPresentation;
  readonly preferredSubtitleDelivery?: SubtitleDelivery;
  readonly qualityPreference?: string;
  readonly regionHint?: string;
  readonly intent: "browse" | "focused" | "prefetch" | "play" | "refresh" | "autoplay";
  readonly allowedRuntimes: readonly ProviderRuntime[];
}

export type ProviderRetryBackoff = "none" | "fixed" | "exponential";

export interface ProviderRetryPolicy {
  readonly maxAttempts: number;
  readonly backoff: ProviderRetryBackoff;
  readonly delayMs?: number;
  readonly retryableCodes?: readonly ResolveErrorCode[];
}

export interface ProviderAbortState {
  readonly aborted: boolean;
  readonly reason?: "user-cancelled" | "provider-fallback" | "timeout" | "shutdown";
}

export interface ProviderFetchPort {
  readonly runtime: "browser-safe-fetch" | "direct-http";
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface ProviderRuntimeContext {
  readonly signal?: AbortSignal;
  readonly retryPolicy?: ProviderRetryPolicy;
  readonly fetch?: ProviderFetchPort;
  now(): string;
  emit?(event: ProviderTraceEvent): void;
}

export interface ProviderResolveResult {
  readonly providerId: ProviderId;
  readonly selectedStreamId?: string;
  readonly sources?: readonly ProviderSourceCandidate[];
  readonly variants?: readonly ProviderVariantCandidate[];
  readonly streams: readonly StreamCandidate[];
  readonly subtitles: readonly SubtitleCandidate[];
  readonly cachePolicy?: CachePolicy;
  readonly trace: ResolveTrace;
  readonly failures: readonly ProviderFailure[];
  readonly healthDelta?: ProviderHealthDelta;
}

export interface ProviderModule<TContext extends ProviderRuntimeContext = ProviderRuntimeContext> {
  readonly providerId: ProviderId;
  resolve(input: ProviderResolveInput, context: TContext): Promise<ProviderResolveResult>;
}

export interface PlaybackRecoveryEvent {
  readonly id: string;
  readonly at: string;
  readonly reason:
    | "manifest-expired"
    | "segment-failure"
    | "buffering-timeout"
    | "provider-fallback"
    | "subtitle-fallback"
    | "manual-retry";
  readonly fromProviderId?: ProviderId;
  readonly toProviderId?: ProviderId;
  readonly resumeSeconds?: number;
  readonly traceId?: string;
}
