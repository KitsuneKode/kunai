export type MediaKind = "movie" | "series" | "anime" | "video";

export type ProviderLane = "anime" | "series" | "youtube";

export type YouTubeLiveStatus = "none" | "live" | "upcoming" | "post_live";

export type YouTubeContentShape = "video" | "playlist" | "channel";

export type * from "./provider-cycle";

export type ProviderId = string & { readonly __brand?: "ProviderId" };

export type ProviderRuntime = "browser-safe-fetch" | "direct-http" | "debrid";

/**
 * A newer cour/season exists for a title (AniList SEQUEL media or a TMDB later
 * season), distinct from the in-season episode delta. Single source of truth for
 * the producer signal (`CatalogScheduleService`) and its persisted form
 * (`@kunai/storage` `ReleaseNewSeason`); the continuation engine keeps its own
 * minimal consumer view.
 */
export interface ReleaseNewSeason {
  /** AniList sequel media id, when the newer cour is a separate media (AniList). */
  readonly mediaId?: number;
  /** TMDB season number, when the newer season is on the same series (TMDB). */
  readonly season?: number;
  readonly latestAiredEpisode?: number;
  readonly nextAiringEpisode?: number;
  readonly nextAiringAt?: string;
}

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
  | "provider-metadata"
  | "catalog-static"
  | "catalog-trending"
  | "provider-health"
  | "endpoint-quarantine";

export type StreamPresentation = "sub" | "dub" | "raw";

export type SubtitleDelivery = "hardcoded" | "embedded" | "external";

export type StartupPriority = "fast" | "balanced" | "quality-first";

export type ProviderSelectionReason =
  | "fast-start"
  | "balanced-1080"
  | "balanced-ready"
  | "balanced-budget-expired"
  | "quality-first"
  | "explicit-source"
  | "favorite-source"
  | "ak-required"
  | "provider-fallback";

export interface ProviderSelectionDecision {
  readonly startupPriority: StartupPriority;
  readonly reason: ProviderSelectionReason;
  readonly waitBudgetMs: number;
  readonly selectedQualityRank?: number;
  readonly enrichmentLane: "required" | "optional-foreground" | "late";
}

export interface CachePolicy {
  readonly ttlClass: CacheTtlClass;
  readonly ttlMs?: number;
  readonly staleWhileRevalidateMs?: number;
  readonly scope: "memory" | "local" | "browser" | "edge-metadata" | "account-sync";
  readonly keyParts: readonly string[];
  readonly allowStale?: boolean;
}

export interface ProviderExternalIds {
  readonly anilistId?: string;
  readonly tmdbId?: string;
  readonly imdbId?: string;
  readonly malId?: string;
  readonly youtubeId?: string;
  readonly youtubePlaylistId?: string;
  readonly youtubeChannelId?: string;
  /** Provider-owned title ids discovered at resolve/search time (e.g. AllAnime opaque _id). */
  readonly providerNativeIds?: Readonly<Partial<Record<ProviderId, string>>>;
}

export interface ProviderReleaseInfo {
  readonly airDate?: string;
  readonly availableAt?: string;
  readonly status?: "released" | "upcoming" | "unknown";
  readonly providerConfirmed?: boolean;
}

export interface ProviderArtworkInfo {
  readonly posterUrl?: string;
  readonly backdropUrl?: string;
  readonly thumbnailUrl?: string;
  readonly seekBarVttUrl?: string;
}

export interface ProviderLanguageEvidence {
  readonly role: "audio" | "subtitle" | "hardsub";
  readonly normalizedLanguage?: string;
  readonly nativeLabel?: string;
  readonly sourceId?: string;
  readonly confidence?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface ProviderSourceEvidence {
  readonly sourceId?: string;
  readonly serverId?: string;
  readonly nativeLabel?: string;
  readonly host?: string;
  readonly confidence?: number;
  readonly metadata?: Record<string, unknown>;
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
  readonly externalIds?: ProviderExternalIds;
}

export interface EpisodeIdentity {
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly title?: string;
  readonly airDate?: string;
  readonly release?: ProviderReleaseInfo;
  readonly artwork?: ProviderArtworkInfo;
}

export interface StreamCandidate {
  readonly id: string;
  readonly providerId: ProviderId;
  readonly sourceId?: string;
  readonly variantId?: string;
  readonly url?: string;
  readonly deferredLocator?: string;
  readonly protocol: "hls" | "dash" | "mp4" | "iframe" | "youtube" | "unknown";
  readonly container?: "m3u8" | "mpd" | "mp4" | "webm" | "unknown";
  readonly requiresYtdl?: boolean;
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
  readonly languageEvidence?: readonly ProviderLanguageEvidence[];
  readonly sourceEvidence?: readonly ProviderSourceEvidence[];
  readonly artwork?: ProviderArtworkInfo;
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
  readonly languageEvidence?: readonly ProviderLanguageEvidence[];
  readonly sourceEvidence?: readonly ProviderSourceEvidence[];
  readonly artwork?: ProviderArtworkInfo;
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
  readonly languageEvidence?: readonly ProviderLanguageEvidence[];
  readonly sourceEvidence?: readonly ProviderSourceEvidence[];
  readonly artwork?: ProviderArtworkInfo;
  readonly metadata?: Record<string, unknown>;
}

export interface ProviderSourceInventory {
  readonly providerId: ProviderId;
  readonly selectedStreamId?: string;
  readonly sources?: readonly ProviderSourceCandidate[];
  readonly variants?: readonly ProviderVariantCandidate[];
  readonly streams: readonly StreamCandidate[];
  readonly subtitles: readonly SubtitleCandidate[];
  readonly externalIds?: ProviderExternalIds;
  readonly release?: ProviderReleaseInfo;
  readonly artwork?: ProviderArtworkInfo;
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
  | "yt-dlp-missing"
  | "timeout"
  | "cancelled"
  | "missing-input"
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
  | "retry:aborted"
  | "inventory:audio-modes";

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

export type EndpointFailureClass = "route-dead" | "server-error" | "transient";

export interface EndpointHealthFailureInfo {
  readonly class: EndpointFailureClass;
  readonly titleId?: string;
  readonly at: string;
}

export interface ProviderEndpointHealthRecord {
  readonly providerId: ProviderId;
  readonly endpoint: string;
  readonly failureClass?: EndpointFailureClass;
  readonly consecutiveFailures: number;
  readonly distinctTitleIds: readonly string[];
  readonly quarantinedUntil?: string;
  readonly lastFailureAt?: string;
  readonly updatedAt: string;
}

export interface EndpointHealthPort {
  shouldTry(providerId: ProviderId, endpoint: string): boolean;
  recordFailure(providerId: ProviderId, endpoint: string, info: EndpointHealthFailureInfo): void;
  recordSuccess(providerId: ProviderId, endpoint: string): void;
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
  readonly preferredSourceId?: string;
  readonly preferredStreamId?: string;
  /** Normalized favorite source names (user favorites). Preferred during auto-select when present. */
  readonly favoriteSourceNames?: readonly string[];
  readonly preferredAudioLanguage?: string;
  readonly preferredSubtitleLanguage?: string;
  readonly preferredPresentation?: StreamPresentation;
  readonly preferredSubtitleDelivery?: SubtitleDelivery;
  readonly qualityPreference?: string;
  readonly startupPriority?: StartupPriority;
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

export type RelayMethod = "GET" | "POST" | "HEAD";

export type RelayErrorCode =
  | "unknown-provider"
  | "provider-not-relayable"
  | "host-not-allowed"
  | "protocol-not-allowed"
  | "method-not-allowed"
  | "headers-rejected"
  | "body-too-large"
  | "response-too-large"
  | "redirect-not-allowed"
  | "unauthorized"
  | "upstream-timeout"
  | "upstream-error"
  | "bad-request";

export interface RelayProfile {
  readonly upstreamHosts: readonly string[];
  readonly videoRelayHosts?: readonly string[];
  readonly maxRequestBodyBytes?: number;
  readonly maxResponseBodyBytes?: number;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
  readonly allowedMethods?: readonly RelayMethod[];
}

export interface ProviderRelayProviderConfig {
  readonly enabled?: boolean;
  readonly videoFallback?: boolean;
}

export interface ProviderRelayConfig {
  readonly enabled?: boolean;
  readonly baseUrl?: string;
  readonly token?: string;
  readonly fallbackToDirect?: boolean;
  readonly providers?: Readonly<Record<string, ProviderRelayProviderConfig>>;
}

export interface RelayRpcRequest {
  readonly method: RelayMethod;
  readonly upstreamUrl: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface RelayRpcErrorBody {
  readonly error: {
    readonly code: RelayErrorCode;
    readonly providerId?: string;
    readonly message: string;
  };
}

export interface ProviderAuthPort {
  getSecret(providerId: ProviderId, key: string): string | undefined;
}

/** Durable catalog-id → provider-native id bridge (SQLite cache adapter in CLI). */
export interface ProviderTitleBridgePort {
  get(input: {
    readonly providerId: ProviderId;
    readonly catalogKind: MediaKind;
    readonly catalogId: string;
  }): string | undefined;
  set(input: {
    readonly providerId: ProviderId;
    readonly catalogKind: MediaKind;
    readonly catalogId: string;
    readonly nativeId: string;
  }): void;
}

export interface ProviderRuntimeContext {
  readonly providerId?: ProviderId;
  readonly signal?: AbortSignal;
  readonly retryPolicy?: ProviderRetryPolicy;
  readonly fetch?: ProviderFetchPort;
  readonly auth?: ProviderAuthPort;
  readonly endpointHealth?: EndpointHealthPort;
  readonly titleBridge?: ProviderTitleBridgePort;
  now(): string;
  emit?(event: ProviderTraceEvent): void;
}

export interface ProviderSearchInput {
  readonly query: string;
  readonly preferredAudioLanguage?: string;
  readonly preferredSubtitleLanguage?: string;
}

export interface ProviderSearchResult {
  readonly id: string;
  readonly type: "movie" | "series";
  readonly title: string;
  readonly year?: string;
  readonly overview?: string;
  readonly posterPath?: string | null;
  readonly metadataSource?: string;
  readonly rating?: number | null;
  readonly popularity?: number | null;
  readonly episodeCount?: number;
  readonly availableAudioModes?: readonly ("sub" | "dub")[];
  readonly subtitleAvailability?: "hardsub" | "softsub" | "unknown";
  readonly englishTitle?: string;
  readonly nativeTitle?: string;
  readonly altNames?: readonly string[];
  readonly externalIds?: ProviderExternalIds;
  readonly release?: ProviderReleaseInfo;
  readonly artwork?: ProviderArtworkInfo;
  readonly languageEvidence?: readonly ProviderLanguageEvidence[];
  readonly durationSeconds?: number;
  readonly channelTitle?: string;
  readonly channelId?: string;
  readonly viewCount?: number;
  readonly publishedAt?: string;
  readonly liveStatus?: YouTubeLiveStatus;
  readonly premium?: boolean;
  readonly paid?: boolean;
  readonly contentShape?: YouTubeContentShape;
}

export interface ProviderEpisodeListInput {
  readonly title: TitleIdentity;
  readonly preferredAudioLanguage?: string;
  readonly preferredSubtitleLanguage?: string;
}

export interface ProviderEpisodeOption {
  readonly index: number;
  readonly label: string;
  /** Canonical episode title when the provider catalog supplies one (separate from display label). */
  readonly name?: string;
  readonly detail?: string;
  readonly totalEpisodeCount?: number;
  readonly externalIds?: ProviderExternalIds;
  readonly release?: ProviderReleaseInfo;
  readonly artwork?: ProviderArtworkInfo;
}

export interface ProviderResolveResult extends ProviderSourceInventory {
  readonly status: "resolved" | "exhausted";
  readonly cachePolicy?: CachePolicy;
  readonly selectionDecision?: ProviderSelectionDecision;
  readonly trace: ResolveTrace;
  readonly failures: readonly ProviderFailure[];
  readonly healthDelta?: ProviderHealthDelta;
  /** Set when the provider already probed the selected stream URL during resolve. */
  readonly streamReachabilityVerified?: boolean;
}

export function isProviderStreamReachabilityVerified(
  result: Pick<ProviderResolveResult, "streamReachabilityVerified"> | null | undefined,
): boolean {
  return result?.streamReachabilityVerified === true;
}

export function getProviderSourceInventory(result: ProviderResolveResult): ProviderSourceInventory {
  return {
    providerId: result.providerId,
    selectedStreamId: result.selectedStreamId,
    sources: result.sources,
    variants: result.variants,
    streams: result.streams,
    subtitles: result.subtitles,
    externalIds: result.externalIds,
    release: result.release,
    artwork: result.artwork,
  };
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

export interface ProviderModule<TContext extends ProviderRuntimeContext = ProviderRuntimeContext> {
  readonly providerId: ProviderId;
  resolve(input: ProviderResolveInput, context: TContext): Promise<ProviderResolveResult>;
  search?(
    input: ProviderSearchInput,
    context: TContext,
  ): Promise<readonly ProviderSearchResult[] | null>;
  listEpisodes?(
    input: ProviderEpisodeListInput,
    context: TContext,
  ): Promise<readonly ProviderEpisodeOption[] | null>;
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
