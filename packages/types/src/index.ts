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
  readonly status: "resolved" | "exhausted";
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

export function getProviderResolveStatus(
  result: Pick<ProviderResolveResult, "status">,
): ProviderResolveResult["status"] {
  return result.status;
}

export function isProviderResolveResultResolved(
  result: ProviderResolveResult,
): result is ProviderResolveResult & {
  readonly status: "resolved";
  readonly streams: readonly [StreamCandidate, ...StreamCandidate[]];
} {
  return result.status === "resolved" && result.streams.length > 0;
}

export function isProviderResolveResultExhausted(
  result: ProviderResolveResult,
): result is ProviderResolveResult & { readonly status: "exhausted" } {
  return result.status === "exhausted";
}

export type ProviderFailureClass =
  | "timeout"
  | "network"
  | "rate-limited"
  | "provider-empty"
  | "provider-parse"
  | "expired-stream"
  | "unsupported-title"
  | "missing-input"
  | "user-cancelled"
  | "runtime-missing"
  | "blocked"
  | "sub-dub-mismatch"
  | "title-episode-gap"
  | "unknown";

export type ProviderFallbackPolicy = "auto-fallback" | "guided-action" | "no-fallback";

export type ProviderFailureClassification = {
  readonly failureClass: ProviderFailureClass;
  readonly fallbackPolicy: ProviderFallbackPolicy;
  readonly retryable: boolean;
  readonly userSummary: string;
  readonly developerDetail: string;
};

export type ClassifiableProviderFailure = {
  readonly providerId?: string;
  readonly code?: ResolveErrorCode | string;
  readonly message?: string;
  readonly retryable?: boolean;
  readonly status?: number;
  readonly failure?: ProviderFailure;
};

const AUTO_FALLBACK_PROVIDER_FAILURE_CLASSES = new Set<ProviderFailureClass>([
  "timeout",
  "network",
  "rate-limited",
  "provider-empty",
  "provider-parse",
  "expired-stream",
]);

const GUIDED_ACTION_PROVIDER_FAILURE_CLASSES = new Set<ProviderFailureClass>([
  "blocked",
  "sub-dub-mismatch",
  "title-episode-gap",
]);

export function classifyProviderFailure(failure: unknown): ProviderFailureClassification {
  const normalized = normalizeProviderFailure(failure);
  const failureClass = classifyProviderFailureClass(normalized);
  const fallbackPolicy = fallbackPolicyForProviderFailureClass(failureClass, normalized);

  return {
    failureClass,
    fallbackPolicy,
    retryable: normalized.retryable ?? fallbackPolicy === "auto-fallback",
    userSummary: buildProviderFailureUserSummary(normalized.providerId, failureClass),
    developerDetail: buildProviderFailureDeveloperDetail(normalized),
  };
}

export function fallbackPolicyForProviderFailureClass(
  failureClass: ProviderFailureClass,
  failure?: ClassifiableProviderFailure,
): ProviderFallbackPolicy {
  if (failure?.retryable === false && !GUIDED_ACTION_PROVIDER_FAILURE_CLASSES.has(failureClass)) {
    return "no-fallback";
  }
  if (AUTO_FALLBACK_PROVIDER_FAILURE_CLASSES.has(failureClass)) return "auto-fallback";
  if (GUIDED_ACTION_PROVIDER_FAILURE_CLASSES.has(failureClass)) return "guided-action";
  return "no-fallback";
}

function normalizeProviderFailure(failure: unknown): ClassifiableProviderFailure {
  if (isClassifiableProviderFailure(failure)) {
    if (isClassifiableProviderFailure(failure.failure)) return failure.failure;
    return failure;
  }

  if (failure instanceof Error) {
    return {
      code: providerFailureCodeFromMessage(failure.message),
      message: failure.message,
    };
  }

  return {
    code: "unknown",
    message: String(failure),
  };
}

function classifyProviderFailureClass(failure: ClassifiableProviderFailure): ProviderFailureClass {
  const code = failure.code;
  if (code === "timeout") return "timeout";
  if (code === "network-error" || code === "provider-unavailable") return "network";
  if (code === "rate-limited") return "rate-limited";
  if (code === "not-found") return "provider-empty";
  if (code === "parse-failed") return "provider-parse";
  if (code === "expired") return "expired-stream";
  if (code === "unsupported-title") return "unsupported-title";
  if (code === "runtime-missing") return "runtime-missing";
  if (code === "blocked") return "blocked";
  if (code === "cancelled") return "user-cancelled";

  const message = (failure.message ?? "").toLowerCase();
  if (message.includes("abort") || message.includes("cancel")) return "user-cancelled";
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (message.includes("rate limit") || message.includes("429")) return "rate-limited";
  if (message.includes("403") || message.includes("blocked")) return "blocked";
  if (message.includes("subtitle") && message.includes("dub")) return "sub-dub-mismatch";
  if (message.includes("episode") && (message.includes("missing") || message.includes("gap"))) {
    return "title-episode-gap";
  }
  if (
    message.includes("empty") ||
    message.includes("no playable") ||
    message.includes("not found")
  ) {
    return "provider-empty";
  }
  if (message.includes("parse")) return "provider-parse";
  if (message.includes("network") || message.includes("fetch")) return "network";

  if (typeof failure.status === "number") {
    if (failure.status === 408 || failure.status === 504) return "timeout";
    if (failure.status === 429) return "rate-limited";
    if (failure.status === 401 || failure.status === 403) return "blocked";
    if (failure.status === 404) return "provider-empty";
    if (failure.status >= 500) return "network";
  }

  return "unknown";
}

function buildProviderFailureUserSummary(
  providerId: string | undefined,
  failureClass: ProviderFailureClass,
): string {
  const prefix = providerId ? `${formatProviderName(providerId)} ` : "Provider ";
  switch (failureClass) {
    case "timeout":
      return `${prefix}is taking longer than expected.`;
    case "network":
      return `${prefix}had a network issue.`;
    case "rate-limited":
      return `${prefix}is rate limiting requests.`;
    case "provider-empty":
      return `${prefix}did not return a playable stream.`;
    case "provider-parse":
      return `${prefix}returned data Kunai could not read.`;
    case "expired-stream":
      return `${prefix}returned an expired stream.`;
    case "blocked":
      return `${prefix}appears blocked right now.`;
    case "sub-dub-mismatch":
      return `${prefix}does not match the selected sub/dub preference.`;
    case "title-episode-gap":
      return `${prefix}does not have this episode available yet.`;
    case "runtime-missing":
      return "A required local runtime is missing.";
    case "missing-input":
      return "Kunai is missing required playback input.";
    case "user-cancelled":
      return "Playback resolution was cancelled.";
    case "unsupported-title":
      return `${prefix}does not support this title.`;
    case "unknown":
      return `${prefix}had an unexpected issue.`;
  }
}

function buildProviderFailureDeveloperDetail(failure: ClassifiableProviderFailure): string {
  const provider = failure.providerId ? `provider=${failure.providerId}` : "provider=unknown";
  const code = failure.code ? `code=${failure.code}` : "code=unknown";
  const retryable =
    typeof failure.retryable === "boolean" ? `retryable=${failure.retryable}` : "retryable=unknown";
  const message = failure.message
    ? `message=${truncateProviderFailureDetail(failure.message, 500)}`
    : "message=none";
  return `${provider} ${code} ${retryable} ${message}`;
}

function providerFailureCodeFromMessage(message: string): ResolveErrorCode | "unknown" {
  const lower = message.toLowerCase();
  if (lower.includes("abort") || lower.includes("cancel")) return "cancelled";
  if (lower.includes("timeout") || lower.includes("timed out")) return "timeout";
  if (lower.includes("runtime") && lower.includes("missing")) return "runtime-missing";
  return "unknown";
}

function isClassifiableProviderFailure(value: unknown): value is ClassifiableProviderFailure {
  return typeof value === "object" && value !== null;
}

function formatProviderName(providerId: string): string {
  return providerId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function truncateProviderFailureDetail(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
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
