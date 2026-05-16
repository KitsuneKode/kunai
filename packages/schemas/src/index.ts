import type {
  CachePolicy,
  ProviderFailure,
  ProviderHealth,
  ProviderSourceCandidate,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  ResolveTrace,
  StreamCandidate,
  SubtitleCandidate,
} from "@kunai/types";
import { z } from "zod";

export const mediaKindSchema = z.enum(["movie", "series", "anime"]);
export const providerRuntimeSchema = z.enum(["browser-safe-fetch", "direct-http", "debrid"]);
export const providerOperationSchema = z.enum([
  "search",
  "list-episodes",
  "resolve-stream",
  "resolve-subtitles",
  "refresh-source",
  "health-check",
]);
export const cacheTtlClassSchema = z.enum([
  "never-cache",
  "session",
  "stream-manifest",
  "direct-media-url",
  "subtitle-list",
  "episode-list",
  "catalog-static",
  "catalog-trending",
  "provider-health",
]);
export const streamPresentationSchema = z.enum(["sub", "dub", "raw"]);
export const subtitleDeliverySchema = z.enum(["hardcoded", "embedded", "external"]);
export const resolveErrorCodeSchema = z.enum([
  "provider-unavailable",
  "unsupported-title",
  "not-found",
  "network-error",
  "rate-limited",
  "blocked",
  "expired",
  "parse-failed",
  "runtime-missing",
  "timeout",
  "cancelled",
  "unknown",
]);

export const cachePolicySchema = z.object({
  ttlClass: cacheTtlClassSchema,
  ttlMs: z.number().int().nonnegative().optional(),
  staleWhileRevalidateMs: z.number().int().nonnegative().optional(),
  scope: z.enum(["memory", "local", "browser", "edge-metadata", "account-sync"]),
  keyParts: z.array(z.string().min(1)),
  allowStale: z.boolean().optional(),
}) satisfies z.ZodType<CachePolicy>;

export const titleIdentitySchema = z.object({
  id: z.string().min(1),
  kind: mediaKindSchema,
  title: z.string().min(1),
  year: z.number().int().optional(),
  anilistId: z.string().min(1).optional(),
  tmdbId: z.string().min(1).optional(),
  imdbId: z.string().min(1).optional(),
  malId: z.string().min(1).optional(),
});

export const episodeIdentitySchema = z.object({
  season: z.number().int().positive().optional(),
  episode: z.number().int().positive().optional(),
  absoluteEpisode: z.number().int().positive().optional(),
  title: z.string().min(1).optional(),
  airDate: z.string().min(1).optional(),
});

export const streamCandidateSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  sourceId: z.string().min(1).optional(),
  variantId: z.string().min(1).optional(),
  url: z.url().optional(),
  deferredLocator: z.string().min(1).optional(),
  protocol: z.enum(["hls", "dash", "mp4", "iframe", "unknown"]),
  container: z.enum(["m3u8", "mpd", "mp4", "webm", "unknown"]).optional(),
  audioLanguages: z.array(z.string().min(1)).optional(),
  presentation: streamPresentationSchema.optional(),
  hardSubLanguage: z.string().min(1).optional(),
  subtitleDelivery: subtitleDeliverySchema.optional(),
  subtitleLanguages: z.array(z.string().min(1)).optional(),
  flavorArchetype: z.string().min(1).optional(),
  flavorLabel: z.string().min(1).optional(),
  serverName: z.string().min(1).optional(),
  qualityLabel: z.string().min(1).optional(),
  qualityRank: z.number().int().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  expiresAt: z.iso.datetime().optional(),
  confidence: z.number().min(0).max(1),
  cachePolicy: cachePolicySchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<StreamCandidate>;

export const subtitleCandidateSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  sourceId: z.string().min(1).optional(),
  variantId: z.string().min(1).optional(),
  url: z.url(),
  language: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  format: z.enum(["srt", "vtt", "ass", "unknown"]).optional(),
  source: z.enum(["provider", "wyzie", "manual", "embedded", "unknown"]),
  confidence: z.number().min(0).max(1),
  syncEvidence: z.string().min(1).optional(),
  cachePolicy: cachePolicySchema,
}) satisfies z.ZodType<SubtitleCandidate>;

export const providerSourceCandidateSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  kind: z.enum([
    "provider-api",
    "embed",
    "file-host",
    "mirror",
    "manifest",
    "direct-media",
    "unknown",
  ]),
  label: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  status: z.enum(["pending", "probing", "available", "selected", "skipped", "failed", "exhausted"]),
  confidence: z.number().min(0).max(1),
  requiresRuntime: providerRuntimeSchema.optional(),
  cachePolicy: cachePolicySchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<ProviderSourceCandidate>;

export const providerVariantCandidateSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  sourceId: z.string().min(1),
  label: z.string().min(1).optional(),
  qualityLabel: z.string().min(1).optional(),
  qualityRank: z.number().int().optional(),
  protocol: z.enum(["hls", "dash", "mp4", "iframe", "unknown"]).optional(),
  container: z.enum(["m3u8", "mpd", "mp4", "webm", "unknown"]).optional(),
  audioLanguages: z.array(z.string().min(1)).optional(),
  presentation: streamPresentationSchema.optional(),
  hardSubLanguage: z.string().min(1).optional(),
  subtitleDelivery: subtitleDeliverySchema.optional(),
  subtitleLanguages: z.array(z.string().min(1)).optional(),
  flavorArchetype: z.string().min(1).optional(),
  flavorLabel: z.string().min(1).optional(),
  streamIds: z.array(z.string().min(1)).optional(),
  subtitleIds: z.array(z.string().min(1)).optional(),
  selected: z.boolean().optional(),
  confidence: z.number().min(0).max(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<ProviderVariantCandidate>;

export const providerFailureSchema = z.object({
  providerId: z.string().min(1),
  code: resolveErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  at: z.iso.datetime(),
}) satisfies z.ZodType<ProviderFailure>;

export const resolveTraceStepSchema = z.object({
  at: z.iso.datetime(),
  stage: z.enum(["cache", "provider", "runtime", "subtitle", "fallback", "player", "health"]),
  message: z.string(),
  providerId: z.string().min(1).optional(),
  durationMs: z.number().nonnegative().optional(),
  attributes: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
});

export const providerTraceEventSchema = z.object({
  type: z.enum([
    "provider:start",
    "provider:success",
    "provider:exhausted",
    "source:start",
    "source:success",
    "source:failed",
    "source:skipped",
    "variant:discovered",
    "variant:selected",
    "subtitle:discovered",
    "subtitle:selected",
    "cache:hit",
    "cache:stale",
    "cache:miss",
    "runtime:requested",
    "runtime:started",
    "runtime:reused",
    "runtime:released",
    "retry:scheduled",
    "retry:aborted",
  ]),
  at: z.iso.datetime(),
  providerId: z.string().min(1),
  sourceId: z.string().min(1).optional(),
  variantId: z.string().min(1).optional(),
  streamId: z.string().min(1).optional(),
  subtitleId: z.string().min(1).optional(),
  attempt: z.number().int().positive().optional(),
  message: z.string(),
  durationMs: z.number().nonnegative().optional(),
  attributes: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
}) satisfies z.ZodType<ProviderTraceEvent>;

export const resolveTraceSchema = z.object({
  id: z.string().min(1),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  title: titleIdentitySchema,
  episode: episodeIdentitySchema.optional(),
  selectedProviderId: z.string().min(1).optional(),
  selectedStreamId: z.string().min(1).optional(),
  cacheHit: z.boolean(),
  runtime: providerRuntimeSchema.optional(),
  steps: z.array(resolveTraceStepSchema),
  events: z.array(providerTraceEventSchema).optional(),
  failures: z.array(providerFailureSchema),
}) satisfies z.ZodType<ResolveTrace>;

export const providerHealthSchema = z.object({
  providerId: z.string().min(1),
  status: z.enum(["healthy", "degraded", "down", "unknown"]),
  checkedAt: z.iso.datetime(),
  medianResolveMs: z.number().nonnegative().optional(),
  recentFailureRate: z.number().min(0).max(1).optional(),
  consecutiveFailures: z.number().int().nonnegative().optional(),
  subtitleSuccessRate: z.number().min(0).max(1).optional(),
  streamSurvivalRate: z.number().min(0).max(1).optional(),
}) satisfies z.ZodType<ProviderHealth>;
