import {
  createProviderCycleFailureError,
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  runProviderCycle,
  type CoreProviderModule,
  providerCycleCandidateTimeoutMs,
} from "@kunai/core";
import type {
  CachePolicy,
  ProviderCycleCandidate,
  ProviderEpisodeOption,
  ProviderFailure,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderSearchResult,
  ProviderSourceCandidate,
  ProviderTraceEvent,
  ResolveErrorCode,
  ProviderVariantCandidate,
  StreamCandidate,
  SubtitleCandidate,
  TitleIdentity,
} from "@kunai/types";
import { parseRetryAfterHeader } from "@kunai/types";

import {
  miruroInventorySourceId,
  miruroCharacterLabel,
  miruroTechnicalServerLabel,
} from "../catalogs/miruro";
import { providerFetch } from "../runtime/fetch";
import { resolveAnimeAudioIntent } from "../shared/anime-audio-intent";
import {
  type AnimeEpisodeMetadata,
  fetchAnimeEpisodeMetadataByNumber,
  formatAnimeEpisodeLabel,
  mergeMiruroEpisodeMetadata,
  shouldSkipExternalEpisodeMetadataEnrichment,
} from "../shared/anime-metadata";
import {
  animeQualityFields,
  formatAnimeSourceArchetype,
  formatAnimeSourceDetail,
  miruroSubtitleDeliveryToMode,
} from "../shared/anime-source-presentation";
import {
  expandHlsMasterInventory,
  isHlsDeadHostStatus,
  looksLikeHlsMasterUrl,
} from "../shared/hls-ladder";
import { isJsonNumber, isJsonString, type JsonObject } from "../shared/json-value";
import { TTLCache } from "../shared/provider-cache";
import { appendCycleEventsToResult, cycleExhaustedResult } from "../shared/provider-cycle";
import { selectProviderEpisodeNumber } from "../shared/provider-episode-number";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import { finalizeCycleSourceInventory } from "../shared/source-inventory";
import { selectReadyStream } from "../shared/startup-selection";
import {
  isStreamReachabilityVerified,
  type StreamReachabilityProbeResult,
} from "../shared/stream-reachability";
import { inferSubtitleFormat, normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import {
  fetchMiruroPlay,
  listMiruroCatalogEpisodes,
  lookupMiruroAnimeByAnilist,
  MiruroCatalogError,
  searchMiruroCatalog,
  type MiruroCatalogAnime,
  type MiruroCatalogPlayResponse,
  type MiruroCatalogProvider,
  type MiruroCatalogServer,
} from "./catalog";
import {
  miruroManifest,
  MIRURO_PROVIDER_ID,
  MIRURO_SERVER_TRY_ORDER,
  rankMiruroServerId,
} from "./manifest";

export { MIRURO_PROVIDER_ID, MIRURO_SERVER_TRY_ORDER };
/** Canonical site origin (browser uses www; bare host redirects). */
export const MIRURO_REFERER = "https://www.miruro.bz/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * One candidate lane's resolve budget. Short on purpose: a lane that cannot
 * produce a verified stream quickly should not hold siblings back inside the
 * attempt budget — that is what turned a dub request into a ~24s wait.
 */
const MIRURO_CANDIDATE_TIMEOUT_MS = 5_000;
/**
 * Ceilings for the module-level caches. They were unbounded, so a long anime
 * session accumulated one entry per title/episode probed and never freed them —
 * the same growth class already bounded for the Videasy Wings transports.
 */
export const MIRURO_CACHE_LIMITS = {
  episodeEntries: 128,
  sourceEntries: 256,
} as const;

/** Cache episode lists per AniList ID. TTL 30 minutes (episode data is stable). */
const episodeCache = new TTLCache<string, unknown>(1_800_000, {
  maxEntries: MIRURO_CACHE_LIMITS.episodeEntries,
});
/** Cache source responses per episode+category. TTL 5 minutes. */
const sourceCache = new TTLCache<string, unknown>(300_000, {
  maxEntries: MIRURO_CACHE_LIMITS.sourceEntries,
});

/**
 * Clear the module caches. The smoke's `KITSUNE_CLEAR_CACHE=1` cleared the CLI
 * cache store but not these, so a "cache cleared" run still answered from them.
 */
export function clearMiruroCachesForTest(): void {
  episodeCache.clear();
  sourceCache.clear();
}

type MiruroStream = {
  readonly url?: string;
  readonly type?: "hls" | "embed" | "mp4";
  readonly quality?: string;
  readonly referer?: string;
  readonly resolution?: { readonly width?: number; readonly height?: number };
  readonly codec?: string;
  readonly audio?: string;
  readonly fansub?: string;
  readonly isActive?: boolean;
};

function isNumericQualityLabel(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().endsWith("p")) return false;
  const digits = trimmed.slice(0, -1);
  if (digits.length === 0) return false;
  for (const ch of digits) {
    if (ch < "0" || ch > "9") return false;
  }
  return true;
}

export type MiruroSourcesResponse = {
  readonly streams?: readonly MiruroStream[];
  readonly subtitles?: readonly MiruroSubtitle[];
  readonly thumbnails?: readonly MiruroThumbnail[];
  readonly intro?: { readonly start: number; readonly end: number };
  readonly outro?: { readonly start: number; readonly end: number };
  readonly download?: string;
};

type MiruroSubtitle = {
  readonly url?: string;
  readonly file?: string;
  readonly lang?: string;
  readonly language?: string;
  readonly label?: string;
};

type MiruroThumbnail = {
  readonly url?: string;
  readonly file?: string;
  readonly type?: string;
};

export type MiruroAudioCategory = "sub" | "dub";
export type MiruroServerKey = string;
export type MiruroSubtitleDelivery = "hardcoded" | "embedded" | "unknown";
export type MiruroServerProfile = {
  readonly id: MiruroServerKey;
  readonly label: string;
  readonly subtitleDelivery: MiruroSubtitleDelivery;
  readonly hardSubLanguage?: string;
};

export type MiruroResolvePayloadOptions = {
  readonly input: ProviderResolveInput;
  readonly sourceData: MiruroSourcesResponse;
  readonly audioCategory: MiruroAudioCategory;
  readonly serverProfile: MiruroServerProfile;
  readonly cachePolicy?: CachePolicy;
  readonly context?: ProviderRuntimeContext;
  readonly startedAt?: string;
  readonly events?: ProviderTraceEvent[];
  readonly failures?: readonly ProviderFailure[];
  /**
   * Bounded probe evidence for the stream this payload selects. Reachability is
   * attested only when a probe actually reported `reachable`; absent, timed-out,
   * and unreachable probes all leave reachability unknown so the CLI's own
   * stream-health gate keeps probing instead of trusting an unproven claim.
   */
  readonly streamReachabilityProbe?: StreamReachabilityProbeResult;
};

type MiruroEpisodeEntry = {
  readonly id: string;
  readonly number: number;
  readonly title?: string;
  readonly airDate?: string;
  readonly description?: string;
  readonly image?: string;
  readonly filler?: boolean;
};

type MiruroProviderEpisodes = {
  readonly sub?: readonly MiruroEpisodeEntry[];
  readonly dub?: readonly MiruroEpisodeEntry[];
};

type MiruroProviderEntry = {
  readonly episodes?: MiruroProviderEpisodes;
};

export type MiruroEpisodesResponse = {
  readonly mappings?: JsonObject;
  readonly providers?: Record<string, MiruroProviderEntry | undefined>;
};

type MiruroCycleCandidateMetadata = {
  readonly audioCategory: MiruroAudioCategory;
  readonly episodeId: string;
  readonly serverId: MiruroServerKey;
  readonly subtitleDelivery: MiruroSubtitleDelivery;
  readonly sourceDetail?: string;
};

export async function createMiruroResultFromPayload({
  input,
  sourceData,
  audioCategory,
  serverProfile,
  cachePolicy,
  context,
  startedAt,
  events = [],
  failures = [],
  streamReachabilityProbe,
}: MiruroResolvePayloadOptions): Promise<ProviderResolveResult | null> {
  const policy =
    cachePolicy ??
    createProviderCachePolicy({
      providerId: MIRURO_PROVIDER_ID,
      title: input.title,
      episode: input.episode,
      subtitleLanguage: input.preferredSubtitleLanguage,
      qualityPreference: input.qualityPreference,
      startupPriority: input.startupPriority,
    });
  const sourceId = miruroInventorySourceId(serverProfile.id, audioCategory);
  const { streams: expandedStreams, deadHosts } = await expandMiruroStreams(
    sourceData.streams ?? [],
    context,
    context?.signal,
  );
  if (deadHosts.length > 0) {
    emitTraceEvent(events, context, {
      type: "source:failed",
      providerId: MIRURO_PROVIDER_ID,
      sourceId,
      message: `${displayMiruroSourceLabel(serverProfile, audioCategory)} dropped ${deadHosts.length} dead stream(s): ${deadHosts.join(", ")}`,
    });
  }
  const rawStreams = rankMiruroStreams(
    expandedStreams.filter(
      (s) => (s.type === "hls" || s.type === "mp4") && s.url && !isMiruroPlaceholderStream(s),
    ),
  );
  if (rawStreams.length === 0) return null;
  const subtitlePresentation = resolveMiruroSubtitlePresentation(
    audioCategory,
    sourceData,
    input.preferredSubtitleLanguage,
  );
  const resolvedServerProfile: MiruroServerProfile = {
    ...serverProfile,
    subtitleDelivery: subtitlePresentation.subtitleDelivery,
    hardSubLanguage: subtitlePresentation.hardSubLanguage,
  };
  const displaySourceLabel = displayMiruroSourceLabel(resolvedServerProfile, audioCategory);
  const sourceDetail = formatAnimeSourceDetail({
    audio: audioCategory,
    subtitleMode: miruroSubtitleDeliveryToMode(resolvedServerProfile.subtitleDelivery),
  });
  const subtitleDelivery = subtitlePresentation.subtitleDelivery;
  const playbackHost = resolveMiruroPlaybackHost(rawStreams[0]?.url);
  const flavorArchetype = formatAnimeSourceArchetype({
    audio: audioCategory,
    detail: displaySourceLabel,
  });

  const seekBarVttUrl = firstMiruroThumbnailUrl(sourceData.thumbnails);
  const artwork = seekBarVttUrl ? { seekBarVttUrl } : undefined;
  const timingMetadata = createMiruroTimingMetadata(sourceData);
  const streams: StreamCandidate[] = [];
  const variants: ProviderVariantCandidate[] = [];
  const subtitles = subtitlePresentation.includeExternalSubtitles
    ? createMiruroSubtitles(sourceData.subtitles, sourceId, policy)
    : [];
  const languageEvidence = [
    {
      role: "audio" as const,
      normalizedLanguage: audioCategory === "sub" ? "ja" : "en",
      nativeLabel: audioCategory,
      sourceId,
      confidence: 0.85,
      metadata: { server: resolvedServerProfile.id },
    },
    ...(resolvedServerProfile.hardSubLanguage
      ? [
          {
            role: "hardsub" as const,
            normalizedLanguage: resolvedServerProfile.hardSubLanguage,
            nativeLabel: resolvedServerProfile.label,
            sourceId,
            confidence: 0.8,
            metadata: { server: resolvedServerProfile.id },
          },
        ]
      : []),
  ];
  const sourceEvidence = [
    {
      sourceId,
      serverId: resolvedServerProfile.id,
      nativeLabel: resolvedServerProfile.label,
      host: playbackHost,
      confidence: 0.9,
      metadata: {
        audioCategory,
        subtitleDelivery,
      },
    },
  ];

  for (const raw of rawStreams) {
    if (!raw.url) continue;
    const { qualityLabel, qualityRank } = animeQualityFields(raw.quality, raw.resolution?.height);
    const streamId = `stream:${MIRURO_PROVIDER_ID}:${Bun.hash(raw.url).toString(36)}`;
    const variantId = `variant:${MIRURO_PROVIDER_ID}:${sourceId}:${qualityLabel}`;
    const streamReferer = raw.referer || MIRURO_REFERER;
    const streamOrigin = (() => {
      try {
        return new URL(streamReferer).origin;
      } catch {
        return "https://www.miruro.bz";
      }
    })();
    // SAFETY: `subtitleDelivery` is already a MiruroSubtitleDelivery; the
    // literal union is the wire spelling of the same domain.
    const streamSubtitleDelivery =
      subtitleDelivery === "unknown"
        ? undefined
        : (subtitleDelivery as "hardcoded" | "embedded" | "external");
    const isMp4 = raw.type === "mp4";

    streams.push({
      id: streamId,
      providerId: MIRURO_PROVIDER_ID,
      sourceId,
      variantId,
      url: raw.url,
      protocol: isMp4 ? "mp4" : "hls",
      container: isMp4 ? "mp4" : "m3u8",
      audioLanguages: audioCategory === "sub" ? ["ja"] : ["en"],
      presentation: audioCategory,
      hardSubLanguage: resolvedServerProfile.hardSubLanguage,
      subtitleDelivery: streamSubtitleDelivery,
      subtitleLanguages: subtitlePresentation.subtitleLanguages,
      serverName: resolvedServerProfile.label,
      flavorArchetype,
      flavorLabel: displaySourceLabel,
      qualityLabel,
      qualityRank,
      languageEvidence,
      sourceEvidence,
      artwork,
      headers: {
        Referer: streamReferer,
        Origin: streamOrigin,
        "User-Agent": USER_AGENT,
      },
      confidence: 0.95,
      cachePolicy: policy,
      metadata: timingMetadata
        ? { ...timingMetadata, sourceDetail, server: resolvedServerProfile.id }
        : { sourceDetail, server: resolvedServerProfile.id },
    });

    variants.push({
      id: variantId,
      providerId: MIRURO_PROVIDER_ID,
      sourceId,
      qualityLabel,
      qualityRank,
      protocol: isMp4 ? "mp4" : "hls",
      container: isMp4 ? "mp4" : "m3u8",
      audioLanguages: audioCategory === "sub" ? ["ja"] : ["en"],
      presentation: audioCategory,
      hardSubLanguage: resolvedServerProfile.hardSubLanguage,
      subtitleDelivery: streamSubtitleDelivery,
      subtitleLanguages: subtitlePresentation.subtitleLanguages,
      flavorArchetype,
      flavorLabel: displaySourceLabel,
      streamIds: [streamId],
      subtitleIds: subtitles.map((subtitle) => subtitle.id),
      confidence: 0.95,
      languageEvidence,
      sourceEvidence,
      artwork,
    });
  }

  // Keep Miruro rank order (active → CDN → quality) for selection, then present
  // the inventory sorted by quality. preferProviderReadyOrder keeps CDN hosts
  // ahead of brittle direct rows when the user has not pinned quality.
  const selection = selectReadyStream(streams, {
    startupPriority: input.startupPriority,
    qualityPreference: input.qualityPreference,
    preferredStreamId: input.preferredStreamId,
    preferredSourceId: input.preferredSourceId,
    favoriteSourceNames: input.favoriteSourceNames,
    preferProviderReadyOrder: true,
  });
  const selectedStream = selection.selected;
  streams.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));
  variants.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));

  const endedAt = context?.now() ?? new Date().toISOString();
  return {
    status: "resolved",
    providerId: MIRURO_PROVIDER_ID,
    selectedStreamId: selectedStream.id,
    selectionDecision: selection.decision,
    streamReachabilityVerified:
      streamReachabilityProbe && isStreamReachabilityVerified(streamReachabilityProbe)
        ? true
        : undefined,
    sources: [
      {
        id: sourceId,
        providerId: MIRURO_PROVIDER_ID,
        kind: "provider-api",
        label: displaySourceLabel,
        host: miruroInventoryHost(),
        status: "selected",
        confidence: 0.9,
        requiresRuntime: "direct-http",
        cachePolicy: policy,
        sourceEvidence,
        artwork,
        metadata: {
          audioCategory,
          subtitleDelivery,
          server: serverProfile.id,
          nativeLabel: serverProfile.label,
          flavorLabel: displaySourceLabel,
          flavorArchetype,
          sourceDetail,
        },
      },
    ],
    streams,
    variants,
    subtitles,
    artwork,
    cachePolicy: policy,
    trace: createResolveTrace({
      title: input.title,
      episode: input.episode,
      providerId: MIRURO_PROVIDER_ID,
      streamId: selectedStream.id,
      cacheHit: false,
      runtime: "direct-http",
      startedAt,
      endedAt,
      steps: [
        createTraceStep("provider", "Resolved Miruro through catalog API", {
          providerId: MIRURO_PROVIDER_ID,
          attributes: { streams: streams.length },
        }),
      ],
      events,
      failures,
    }),
    failures,
    healthDelta: {
      providerId: MIRURO_PROVIDER_ID,
      outcome: "success",
      at: endedAt,
    },
  };
}

function createMiruroSubtitles(
  subtitles: readonly MiruroSubtitle[] | undefined,
  sourceId: string,
  cachePolicy: CachePolicy,
): SubtitleCandidate[] {
  return (subtitles ?? []).flatMap((subtitle) => {
    const url = subtitle.url ?? subtitle.file;
    if (!url) return [];
    const rawLanguage = subtitle.lang ?? subtitle.language ?? subtitle.label ?? "unknown";
    return [
      {
        id: `subtitle:${MIRURO_PROVIDER_ID}:${Bun.hash(url).toString(36)}`,
        providerId: MIRURO_PROVIDER_ID,
        sourceId,
        url,
        language: normalizeIsoLanguageCode(rawLanguage),
        label: subtitle.label ?? rawLanguage,
        format: inferSubtitleFormat(url),
        source: "provider" as const,
        confidence: 0.9,
        cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" as const },
      },
    ];
  });
}

function firstMiruroThumbnailUrl(
  thumbnails: readonly MiruroThumbnail[] | undefined,
): string | undefined {
  const thumbnail = thumbnails?.find((entry) => entry.url || entry.file);
  return thumbnail?.url ?? thumbnail?.file;
}

type MiruroTimingSegment = { readonly start: number; readonly end: number };

type MiruroTimingMetadata = {
  intro?: MiruroTimingSegment;
  outro?: MiruroTimingSegment;
};

function createMiruroTimingMetadata(
  sourceData: MiruroSourcesResponse,
): MiruroTimingMetadata | null {
  const metadata: MiruroTimingMetadata = {};
  const intro = normalizeMiruroTimingSegment(sourceData.intro);
  const outro = normalizeMiruroTimingSegment(sourceData.outro);
  if (intro) metadata.intro = intro;
  if (outro) metadata.outro = outro;
  return Object.keys(metadata).length > 0 ? metadata : null;
}

function normalizeMiruroTimingSegment(
  segment: MiruroTimingSegment | undefined,
): MiruroTimingSegment | null {
  if (!segment) return null;
  if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end)) return null;
  if (segment.end <= segment.start) return null;
  return { start: segment.start, end: segment.end };
}

function sortMiruroProviderEntries(
  entries: readonly (readonly [string, MiruroProviderEntry | undefined])[],
): readonly (readonly [string, MiruroProviderEntry | undefined])[] {
  return [...entries].sort(([a], [b]) => rankMiruroServerId(a) - rankMiruroServerId(b));
}

/**
 * Did Miruro resolve a different audio presentation than the one asked for?
 *
 * Miruro walks the fallback audio when the requested one has no working server,
 * so a dub request can resolve a sub. Callers emit `audio:fallback` on a true
 * result so the downgrade stops being silent.
 */
export function isMiruroAudioFallback(
  requested: MiruroAudioCategory,
  resolved: string | undefined,
): boolean {
  // Only sub/dub are audio presentations; anything else is not a downgrade.
  return (resolved === "sub" || resolved === "dub") && resolved !== requested;
}

/**
 * Priority bands for the cycle builder. The audio is the user's choice, so each
 * audio category owns a band no boost inside it can leave; a subtitle-delivery
 * match only reorders servers within the band, and a source the user picked
 * outranks every band.
 */
const MIRURO_AUDIO_BAND = 10_000;
const MIRURO_DELIVERY_MATCH_BOOST = 1_000;
const MIRURO_PICKED_SOURCE_BOOST = 100_000;

export function buildMiruroCycleCandidates({
  providers,
  episodes,
  episodeNum,
  targetAudio,
  fallbackAudio,
  preferredSubtitleDelivery,
  preferredSourceId,
}: {
  readonly providers?: Record<string, MiruroProviderEntry | undefined>;
  readonly episodes?: MiruroProviderEpisodes;
  readonly episodeNum: number;
  readonly targetAudio: MiruroAudioCategory;
  readonly fallbackAudio: MiruroAudioCategory;
  readonly preferredSubtitleDelivery?: MiruroSubtitleDelivery;
  readonly preferredSourceId?: string;
}): ProviderCycleCandidate[] {
  const candidates: ProviderCycleCandidate[] = [];
  const audioOrder: readonly MiruroAudioCategory[] =
    targetAudio === fallbackAudio ? [targetAudio] : [targetAudio, fallbackAudio];
  const providerEntries = providers
    ? sortMiruroProviderEntries(Object.entries(providers))
    : MIRURO_SERVER_TRY_ORDER.map((server) => [server, { episodes }] as const);

  for (const [audioRank, audioCategory] of audioOrder.entries()) {
    let serverRank = 0;
    for (const [providerKey, providerEntry] of providerEntries) {
      const episodeEntry = findMiruroEpisodeEntry(
        providerEntry?.episodes?.[audioCategory],
        episodeNum,
      );
      if (!episodeEntry?.id) continue;
      const serverProfile = createMiruroServerProfile(providerKey, audioCategory);
      const sourceId = miruroInventorySourceId(serverProfile.id, audioCategory);
      const characterLabel = displayMiruroSourceLabel(serverProfile, audioCategory);
      const sourceDetail = formatAnimeSourceDetail({
        audio: audioCategory,
        subtitleMode: miruroSubtitleDeliveryToMode(serverProfile.subtitleDelivery),
      });
      // Delivery ranks servers within the requested audio, never across it. It
      // used to lift every sub server by 5000, and the adapter prefers hard
      // subs for all anime, so a dub request played a sub whenever one worked.
      const deliveryBoost =
        preferredSubtitleDelivery !== undefined &&
        preferredSubtitleDelivery !== "unknown" &&
        serverProfile.subtitleDelivery === preferredSubtitleDelivery
          ? MIRURO_DELIVERY_MATCH_BOOST
          : 0;
      const pickedBoost = sourceId === preferredSourceId ? MIRURO_PICKED_SOURCE_BOOST : 0;
      candidates.push({
        id: `candidate:${sourceId}:${audioCategory}:${episodeEntry.id}`,
        providerId: MIRURO_PROVIDER_ID,
        sourceId,
        serverId: serverProfile.id,
        groupId: audioCategory,
        label: characterLabel,
        nativeLabel: serverProfile.label,
        normalizedAudioLanguage: audioCategory === "sub" ? "ja" : "en",
        normalizedSubtitleLanguage: serverProfile.hardSubLanguage,
        presentation: audioCategory,
        priority: audioRank * MIRURO_AUDIO_BAND + serverRank - deliveryBoost - pickedBoost,
        metadata: {
          audioCategory,
          episodeId: episodeEntry.id,
          serverId: serverProfile.id,
          subtitleDelivery: serverProfile.subtitleDelivery,
          sourceDetail,
        } satisfies MiruroCycleCandidateMetadata & { readonly sourceDetail: string },
      });
      serverRank += 1;
    }
  }

  return candidates;
}

function buildMiruroSourceInventoryCandidates(
  candidates: readonly ProviderCycleCandidate[],
  cachePolicy: CachePolicy,
): readonly ProviderSourceCandidate[] {
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const sourceId = candidate.sourceId;
    if (!sourceId || seen.has(sourceId)) return [];
    seen.add(sourceId);

    // SAFETY: this candidate was built by miruro's own cycle path; the metadata
    // keys read below are the ones writeMiruroCycleCandidateMetadata wrote.
    const metadata = (candidate.metadata ?? {}) as MiruroCycleCandidateMetadata;
    const audioCategory = metadata.audioCategory === "dub" ? "dub" : "sub";
    const serverId = String(candidate.serverId ?? metadata.serverId ?? "");
    const subtitleDelivery =
      metadata.subtitleDelivery === "embedded" || metadata.subtitleDelivery === "hardcoded"
        ? metadata.subtitleDelivery
        : audioCategory === "sub"
          ? "hardcoded"
          : "unknown";
    const label = candidate.label ?? miruroCharacterLabel(serverId, audioCategory);
    const serverLabel = candidate.nativeLabel ?? miruroTechnicalServerLabel(serverId);
    const sourceDetail =
      metadata.sourceDetail ??
      formatAnimeSourceDetail({
        audio: audioCategory,
        subtitleMode: miruroSubtitleDeliveryToMode(subtitleDelivery),
      });
    const host = miruroInventoryHost();

    return [
      {
        id: sourceId,
        providerId: MIRURO_PROVIDER_ID,
        kind: "provider-api",
        label,
        host,
        status: "probing",
        confidence: 0.75,
        requiresRuntime: "direct-http",
        cachePolicy,
        languageEvidence: [
          {
            role: "audio",
            normalizedLanguage: audioCategory === "dub" ? "en" : "ja",
            nativeLabel: audioCategory,
            sourceId,
            confidence: 0.75,
            metadata: { server: serverId },
          },
        ],
        sourceEvidence: [
          {
            sourceId,
            serverId,
            nativeLabel: serverLabel,
            host,
            confidence: 0.75,
            metadata: { audioCategory, subtitleDelivery },
          },
        ],
        metadata: {
          audioCategory,
          episodeId: metadata.episodeId,
          subtitleDelivery,
          server: serverId,
          nativeLabel: serverLabel,
          flavorLabel: label,
          flavorArchetype: formatAnimeSourceArchetype({
            audio: audioCategory,
            detail: label,
          }),
          sourceDetail,
        },
      },
    ];
  });
}

/** Canonical inventory host — matches MIRURO_REFERER / browser origin. */
function miruroInventoryHost(): string {
  try {
    return new URL(MIRURO_REFERER).hostname;
  } catch {
    return "www.miruro.bz";
  }
}

function findMiruroEpisodeEntry(
  episodeList: readonly MiruroEpisodeEntry[] | undefined,
  episodeNum: number,
): MiruroEpisodeEntry | undefined {
  if (!episodeList?.length) return undefined;
  return episodeList.find((entry) => entry.number === episodeNum);
}

function parseMiruroCycleCandidateMetadata(
  candidate: ProviderCycleCandidate,
  context: ProviderRuntimeContext,
): MiruroCycleCandidateMetadata {
  const metadata = candidate.metadata ?? {};
  const audioCategory = metadata.audioCategory;
  const episodeId = metadata.episodeId;
  const serverId = metadata.serverId;
  if (
    (audioCategory !== "sub" && audioCategory !== "dub") ||
    !isJsonString(episodeId) ||
    !isJsonString(serverId) ||
    serverId.length === 0
  ) {
    throw createProviderCycleFailureError(candidate, {
      failureClass: "candidate-unsupported",
      message: `Miruro candidate ${candidate.id} has invalid metadata`,
      retryable: false,
      at: context.now(),
    });
  }

  return {
    audioCategory,
    episodeId,
    serverId,
    subtitleDelivery:
      metadata.subtitleDelivery === "embedded" || metadata.subtitleDelivery === "hardcoded"
        ? metadata.subtitleDelivery
        : "unknown",
  };
}

function collectMiruroAvailableAudioModes(
  providers: Record<string, MiruroProviderEntry | undefined>,
  episodeNum: number,
): ("sub" | "dub")[] {
  const modes = new Set<"sub" | "dub">();
  for (const entry of Object.values(providers)) {
    if (findMiruroEpisodeEntry(entry?.episodes?.sub, episodeNum)) modes.add("sub");
    if (findMiruroEpisodeEntry(entry?.episodes?.dub, episodeNum)) modes.add("dub");
  }
  return (["sub", "dub"] as const).filter((mode) => modes.has(mode));
}

/**
 * Normalise Miruro source stream rows into final, playable leaves.
 *
 * Miruro servers return two incompatible shapes:
 *  - Labeled leaf playlists (e.g. `kiwi`): each row carries `quality` /
 *    `resolution` (`1080p`, `720p`, `360p`) and a direct `.m3u8` URL. The
 *    quality ladder comes straight from the source data.
 *  - Unlabeled master playlists (e.g. `icarus`, `vault-*-direct`): rows have no
 *    `quality`, and the HLS row is a `master.m3u8`.
 *
 * For labeled streams the quality is already final and passes through.
 * For unlabeled masters we attempt a brief fetch to expand into quality
 * variants (most direct-play CDNs respond in <500ms). If the fetch fails
 * ambiguously (403 / timeout / non-master body) the original URL passes
 * through as a single `auto` row — mpv plays a master playlist directly.
 * If the fetch gets a definitive dead answer (5xx / 404 / 410) the stream is
 * dropped instead: mpv would fail identically, and a candidate whose every
 * stream is dead must lose to the next server in the cycle.
 *
 * Expansion fetches are run in parallel and capped at 1.5 s so that
 * gatekept CDNs (owocdn via kwik.cx) do not block the pipeline.
 */
async function expandMiruroStreams(
  streams: readonly MiruroStream[],
  context: ProviderRuntimeContext | undefined,
  signal?: AbortSignal,
): Promise<{ streams: MiruroStream[]; deadHosts: string[] }> {
  const seen = new Set<string>();
  const out: MiruroStream[] = [];
  const deadHosts: string[] = [];

  function push(stream: MiruroStream): void {
    if (!stream.url || seen.has(stream.url)) return;
    seen.add(stream.url);
    out.push({ ...stream, isActive: stream.isActive ?? true });
  }

  const expandable: { stream: MiruroStream; url: string; referer: string }[] = [];

  for (const stream of streams) {
    if (!stream.url || stream.type === "embed") continue;
    if (
      stream.type === "mp4" ||
      (isJsonString(stream.quality) && isNumericQualityLabel(stream.quality))
    ) {
      push(stream);
      continue;
    }
    if (looksLikeHlsMasterUrl(stream.url)) {
      expandable.push({ stream, url: stream.url, referer: stream.referer || MIRURO_REFERER });
      continue;
    }
    push(stream);
  }

  if (expandable.length === 0) return { streams: out, deadHosts };

  const fetchImpl = (url: string, init?: RequestInit) => providerFetch(context, url, init);

  const results = await Promise.allSettled(
    expandable.map(async ({ url, referer }) => {
      const fetchHeaders = {
        "User-Agent": USER_AGENT,
        Referer: referer,
        Origin: (() => {
          try {
            return new URL(referer).origin;
          } catch {
            return "https://www.miruro.bz";
          }
        })(),
      };
      const expandSignal = AbortSignal.timeout(1_500);
      const combinedSignal = signal ? anySignal(signal, expandSignal) : expandSignal;
      return expandHlsMasterInventory({
        fetch: fetchImpl,
        masterUrl: url,
        headers: fetchHeaders,
        signal: combinedSignal,
      });
    }),
  );

  for (let i = 0; i < expandable.length; i++) {
    const entry = expandable[i];
    if (!entry) continue;
    const { stream } = entry;
    const settled = results[i];
    if (!settled || settled.status !== "fulfilled") {
      push(stream);
      continue;
    }

    const { variants, probe } = settled.value;
    if (probe.kind === "http-error" && isHlsDeadHostStatus(probe.httpStatus)) {
      deadHosts.push(`${hostOf(stream.url)} (HTTP ${probe.httpStatus})`);
      continue;
    }
    const first = variants[0];
    const isAutoFallback =
      variants.length === 1 &&
      first?.qualityLabel === "auto" &&
      first?.url === stream.url &&
      (first?.qualityRank ?? 0) <= 0;

    if (isAutoFallback) {
      push(stream);
      continue;
    }

    for (const variant of variants) {
      if (seen.has(variant.url)) continue;
      seen.add(variant.url);
      out.push({
        ...stream,
        url: variant.url,
        quality: variant.qualityLabel,
        resolution:
          variant.qualityRank > 0
            ? { width: Math.round((variant.qualityRank * 16) / 9), height: variant.qualityRank }
            : stream.resolution,
        isActive: stream.isActive ?? true,
      });
    }
  }

  return { streams: out, deadHosts };
}

function hostOf(url: string | undefined): string {
  if (!url) return "unknown-host";
  try {
    return new URL(url).host;
  } catch {
    return "unknown-host";
  }
}

function anySignal(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const removers: Array<() => void> = [];
  const cleanup = () => {
    for (const remove of removers.splice(0)) remove();
  };
  for (const s of signals) {
    if (s.aborted) {
      cleanup();
      controller.abort(s.reason);
      return controller.signal;
    }
    const listener = () => {
      cleanup();
      controller.abort(s.reason);
    };
    s.addEventListener("abort", listener, { once: true });
    removers.push(() => s.removeEventListener("abort", listener));
  }
  return controller.signal;
}

function displayMiruroSourceLabel(
  serverProfile: MiruroServerProfile,
  audioCategory: MiruroAudioCategory,
): string {
  return miruroCharacterLabel(serverProfile.id, audioCategory);
}

function createMiruroServerProfile(
  providerKey: string,
  audioCategory: MiruroAudioCategory = "sub",
): MiruroServerProfile {
  return {
    id: providerKey,
    label: miruroTechnicalServerLabel(providerKey),
    // Align with catalog defaults: sub assumes hardsub until the catalog proves soft.
    subtitleDelivery: audioCategory === "sub" ? "hardcoded" : "unknown",
    hardSubLanguage: audioCategory === "sub" ? "en" : undefined,
  };
}

type MiruroSubtitlePresentation = {
  readonly subtitleDelivery: MiruroSubtitleDelivery;
  readonly hardSubLanguage?: string;
  readonly subtitleLanguages?: readonly string[];
  readonly includeExternalSubtitles: boolean;
};

function resolveMiruroSubtitlePresentation(
  audioCategory: MiruroAudioCategory,
  sourceData: MiruroSourcesResponse,
  preferredSubtitleLanguage?: string,
): MiruroSubtitlePresentation {
  const sourceSubtitles = (sourceData.subtitles ?? []).filter(
    (subtitle) => subtitle.url || subtitle.file,
  );
  if (sourceSubtitles.length > 0) {
    const subtitleLanguages = [
      ...new Set(
        sourceSubtitles
          .map((subtitle) =>
            normalizeIsoLanguageCode(
              subtitle.lang ?? subtitle.language ?? subtitle.label ?? "unknown",
            ),
          )
          .filter((language): language is string => Boolean(language)),
      ),
    ];
    return {
      subtitleDelivery: "embedded",
      subtitleLanguages,
      includeExternalSubtitles: true,
    };
  }

  if (audioCategory === "sub") {
    return {
      subtitleDelivery: "hardcoded",
      hardSubLanguage: normalizeIsoLanguageCode(preferredSubtitleLanguage ?? "en") ?? "en",
      includeExternalSubtitles: false,
    };
  }

  return {
    subtitleDelivery: "unknown",
    includeExternalSubtitles: false,
  };
}

function resolveMiruroPlaybackHost(streamUrl: string | undefined): string {
  if (!streamUrl) return miruroInventoryHost();
  try {
    return new URL(streamUrl).hostname;
  } catch {
    return miruroInventoryHost();
  }
}

function rankMiruroStreams(streams: readonly MiruroStream[]): MiruroStream[] {
  return streams
    .map((stream, index) => ({ stream, index }))
    .sort((a, b) => {
      const activeDelta = Number(b.stream.isActive === true) - Number(a.stream.isActive === true);
      if (activeDelta !== 0) return activeDelta;
      const cdnDelta = Number(isMiruroCdnStream(b.stream)) - Number(isMiruroCdnStream(a.stream));
      if (cdnDelta !== 0) return cdnDelta;
      const qualityDelta =
        qualityRankFromMiruroStream(b.stream) - qualityRankFromMiruroStream(a.stream);
      if (qualityDelta !== 0) return qualityDelta;
      return a.index - b.index;
    })
    .map(({ stream }) => stream);
}

function isMiruroCdnStream(stream: MiruroStream): boolean {
  if (!stream.url) return false;
  try {
    const host = new URL(stream.url).hostname.toLowerCase();
    return host.includes("uwucdn") || host.includes("owocdn");
  } catch {
    return false;
  }
}

/**
 * `bonk`'s CDN (ibyteimg.com) is image-only and serves PNG placeholders for
 * video segments — such streams must never count as a successful resolve.
 */
function isMiruroPlaceholderStream(stream: MiruroStream): boolean {
  if (!stream.url) return false;
  try {
    return new URL(stream.url).hostname.toLowerCase().includes("ibyteimg");
  } catch {
    return false;
  }
}

function qualityRankFromMiruroStream(stream: MiruroStream): number {
  return animeQualityFields(stream.quality, stream.resolution?.height).qualityRank;
}

const MIRURO_ANILIST_ID_PREFIX = "anilist:";

/** Complete positive decimal only — no trimming, no partial parse, no zero. */
function parsePositiveDecimalId(value: string | undefined): string | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  return value;
}

/**
 * The single AniList identity reader for both `listEpisodes()` and `resolve()`.
 * Every Miruro catalog query is keyed on a real AniList id, so a bare, padded, or
 * foreign-catalog id must fail closed here rather than reach the API and come
 * back as an unexplained empty catalog.
 */
export function resolveMiruroAnilistId(title: TitleIdentity): string | null {
  const explicit = parsePositiveDecimalId(title.anilistId);
  if (explicit) return explicit;
  if (!title.id.startsWith(MIRURO_ANILIST_ID_PREFIX)) return null;
  return parsePositiveDecimalId(title.id.slice(MIRURO_ANILIST_ID_PREFIX.length));
}

const MIRURO_EPISODES_CACHE_NAMESPACE = "miruro:episodes";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/**
 * A finished catalog does not change, so it earns the long persistence that
 * makes the restart win worthwhile — the multi-request catalog fetch is paid
 * once every 12h rather than once per session.
 */
const MIRURO_EPISODES_TTL_FINISHED_MS = 12 * HOUR_MS;
/**
 * An airing catalog never persists longer than this, so a just-aired episode is
 * at most this stale even when the next-air estimate is far off.
 */
const MIRURO_EPISODES_TTL_AIRING_FLOOR_MS = 2 * HOUR_MS;
/** Weekly cadence covers almost every simulcast; the next episode is ~7d after the last. */
const MIRURO_EPISODES_WEEKLY_CADENCE_MS = 7 * DAY_MS;
/**
 * If the newest listed episode aired more than this ago the show is treated as
 * finished. A weekly show is at most ~7d between episodes; the extra slack
 * absorbs a late simulcast or an irregular gap before we commit to the long TTL.
 */
const MIRURO_EPISODES_AIRING_WINDOW_MS = 10 * DAY_MS;

/**
 * How long to persist a Miruro episode catalog, from its own episodes' air dates.
 *
 * The catalog is stable for a finished show and volatile for an airing one, so a
 * single flat TTL either wastes the restart win on finished shows or shows a
 * stale catalog for airing ones. Instead:
 *
 * - No parseable air date (edge/empty catalog): treat as finished. Miruro
 *   supplies air dates for airing catalogs, so the missing-date case is not one.
 * - Newest episode aired more than the airing window ago: finished → 12h.
 * - Otherwise airing: the catalog does not change until the next episode airs, so
 *   persist until the approximate next air date (last + ~7d), clamped to
 *   [2h, one week]. An airing catalog can therefore out-persist a finished one,
 *   because its next change point is predictable where a finished show's is not.
 *   The 2h floor keeps a show that is overdue for an episode from thrashing.
 *
 * Pure and exported for unit tests; `now` is injected.
 */
export function computeMiruroEpisodesPersistTtlMs(
  entries: readonly MiruroEpisodeEntry[],
  now: number = Date.now(),
): number {
  let latestAirMs = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    if (!entry.airDate) continue;
    const parsed = Date.parse(entry.airDate);
    if (Number.isFinite(parsed) && parsed > latestAirMs) latestAirMs = parsed;
  }

  if (latestAirMs === Number.NEGATIVE_INFINITY) return MIRURO_EPISODES_TTL_FINISHED_MS;
  if (latestAirMs < now - MIRURO_EPISODES_AIRING_WINDOW_MS) return MIRURO_EPISODES_TTL_FINISHED_MS;

  const untilNextAir = latestAirMs + MIRURO_EPISODES_WEEKLY_CADENCE_MS - now;
  return Math.min(
    MIRURO_EPISODES_WEEKLY_CADENCE_MS,
    Math.max(MIRURO_EPISODES_TTL_AIRING_FLOOR_MS, untilNextAir),
  );
}

/**
 * AniList id → catalog anime row. The bridge is stable for a title's lifetime,
 * so a session-cached lookup keeps `resolve` and `listEpisodes` from paying a
 * second request each.
 */
async function getMiruroCatalogAnime(
  context: ProviderRuntimeContext,
  anilistId: string,
  signal?: AbortSignal,
): Promise<MiruroCatalogAnime | null> {
  const cacheKey = `catalog-anime:${anilistId}`;
  // SAFETY: this cache key namespace only ever holds MiruroCatalogAnime
  // values written by lookupMiruroAnimeByAnilist below.
  const hit = episodeCache.get(cacheKey) as MiruroCatalogAnime | null;
  if (hit) return hit;
  const anime = await lookupMiruroAnimeByAnilist(context, anilistId, signal);
  if (anime) episodeCache.set(cacheKey, anime);
  return anime;
}

/** Shared episode list fetch for listEpisodes + resolve. */
export async function getMiruroEpisodesResponse(
  context: ProviderRuntimeContext,
  anilistId: string,
  signal?: AbortSignal,
): Promise<MiruroEpisodesResponse | null> {
  const cacheKey = `episodes:${anilistId}`;

  // 1. In-memory: instant within a session.
  // SAFETY: this cache key namespace only ever holds MiruroEpisodesResponse
  // values written by the catalog fetch below.
  const memoryHit = episodeCache.get(cacheKey) as MiruroEpisodesResponse | null;
  if (memoryHit) return memoryHit;

  // 2. Persistent: survives a restart, so the cold catalog fetch is paid once
  //    per catalog per TTL rather than once per session.
  const persistentHit = await context.cache?.read<MiruroEpisodesResponse>(
    MIRURO_EPISODES_CACHE_NAMESPACE,
    anilistId,
  );
  if (persistentHit) {
    episodeCache.set(cacheKey, persistentHit);
    return persistentHit;
  }

  // 3. Network: anilist → catalog id → episode list. The lookup is cached in
  //    the same namespace — the bridge is stable for a title's lifetime.
  const anime = await getMiruroCatalogAnime(context, anilistId, signal);
  if (!anime) return null;
  const catalogKind = anime.format === "MOVIE" ? "film" : "regular";
  const catalogEpisodes = await listMiruroCatalogEpisodes(context, anime.id, {
    kind: catalogKind,
    signal,
  });
  const entries: MiruroEpisodeEntry[] = catalogEpisodes.flatMap((entry) => {
    if (!isJsonNumber(entry.episode_number) || entry.episode_number <= 0) return [];
    return [
      {
        id: `${anime.id}:${entry.episode_number}`,
        number: entry.episode_number,
        title: entry.title ?? undefined,
        description: entry.synopsis ?? undefined,
        image: entry.thumbnail_url ?? undefined,
        airDate: entry.air_date ?? undefined,
        // canon_type is the catalog's own filler classification — manga_canon
        // is the "not filler" marker, everything else is non-canon content.
        filler:
          isJsonString(entry.canon_type) && entry.canon_type.length > 0
            ? entry.canon_type !== "manga_canon"
            : undefined,
      },
    ];
  });
  // The catalog list is the canonical episode rail. `episode_counts.dub` is a
  // count, not a per-episode map, so dub availability is honest only at play
  // time — listing it here would invent episode numbers upstream never gave.
  const epData: MiruroEpisodesResponse = {
    providers: { catalog: { episodes: { sub: entries } } },
  };
  episodeCache.set(cacheKey, epData);
  const catalogEntries = selectMiruroEpisodeCatalogEntries(epData);
  if (catalogEntries.length > 0) {
    // Only persist a catalog that actually has episodes. `providers: {}` is
    // truthy, so guarding on it alone would cache an empty body as "this show
    // has no episodes" and starve every later resolve. The TTL is derived from
    // the catalog's own air dates so a finished show persists long and an airing
    // one expires around its next episode.
    void context.cache?.write(
      MIRURO_EPISODES_CACHE_NAMESPACE,
      anilistId,
      epData,
      computeMiruroEpisodesPersistTtlMs(catalogEntries),
    );
  }
  return epData;
}

function selectMiruroEpisodeCatalogEntries(
  epData: MiruroEpisodesResponse | null,
): readonly MiruroEpisodeEntry[] {
  const providers = epData?.providers;
  if (!providers) return [];

  let best: readonly MiruroEpisodeEntry[] = [];
  for (const providerEntry of Object.values(providers)) {
    for (const category of ["sub", "dub"] as const) {
      const entries = providerEntry?.episodes?.[category] ?? [];
      if (entries.length > best.length) best = entries;
    }
  }

  if (best.length > 0) return best;
  const kiwiSub = providers.kiwi?.episodes?.sub;
  const kiwiDub = providers.kiwi?.episodes?.dub;
  return (kiwiSub?.length ? kiwiSub : kiwiDub) ?? [];
}

function readMiruroMappingMalId(mappings: JsonObject | undefined): string | undefined {
  const malId = mappings?.malId;
  if (isJsonNumber(malId) && malId > 0) return String(malId);
  if (isJsonString(malId) && malId.trim()) return malId.trim();
  return undefined;
}

export async function fetchMiruroEpisodeCatalog(
  context: ProviderRuntimeContext,
  anilistId: string,
  signal?: AbortSignal,
): Promise<readonly ProviderEpisodeOption[] | null> {
  const epData = await getMiruroEpisodesResponse(context, anilistId, signal);
  const entries = selectMiruroEpisodeCatalogEntries(epData);
  if (entries.length === 0) return null;

  const metadata = new Map<number, AnimeEpisodeMetadata>();
  mergeMiruroEpisodeMetadata(metadata, entries);

  const malId = readMiruroMappingMalId(epData?.mappings);
  const skipExternal = shouldSkipExternalEpisodeMetadataEnrichment(metadata, entries.length);

  if (!skipExternal) {
    const sharedMetadata = await fetchAnimeEpisodeMetadataByNumber({ anilistId, malId }, signal);
    for (const [number, meta] of sharedMetadata) {
      const existing = metadata.get(number);
      if (!existing) {
        metadata.set(number, meta);
        continue;
      }
      metadata.set(number, {
        ...existing,
        title:
          meta.title && (!existing.title || meta.title.length > existing.title.length)
            ? meta.title
            : existing.title,
        synopsis: existing.synopsis ?? meta.synopsis,
        airDate: existing.airDate ?? meta.airDate,
        thumbnail: existing.thumbnail ?? meta.thumbnail,
        isFiller: existing.isFiller ?? meta.isFiller,
        isRecap: existing.isRecap ?? meta.isRecap,
        source: "merged",
      });
    }
  }

  return entries.map((entry) => {
    const meta = metadata.get(entry.number);
    const title = meta?.title?.trim() || entry.title?.trim();
    const synopsis = meta?.synopsis?.trim() || entry.description?.trim();
    const thumbnail = meta?.thumbnail?.trim() || entry.image?.trim();
    return {
      index: entry.number,
      label: formatAnimeEpisodeLabel(entry.number, title, { filler: meta?.isFiller }),
      name: title || undefined,
      detail: synopsis || entry.id,
      release:
        entry.airDate || meta?.airDate ? { airDate: entry.airDate ?? meta?.airDate } : undefined,
      artwork: thumbnail ? { thumbnailUrl: thumbnail } : undefined,
    };
  });
}

type MiruroResolveFailure = {
  readonly code: ResolveErrorCode;
  readonly message: string;
  readonly retryable: boolean;
};

function classifyMiruroResolveError<T>(error: T): MiruroResolveFailure {
  if (error instanceof MiruroCatalogError) {
    if (error.status === 400) {
      // "Unsupported catalog request" is the allowlist refusing a query shape
      // this code should never have produced — a bug, not a retryable outage.
      return {
        code: "not-found",
        message: `Miruro catalog rejected the request shape: ${error.message}`,
        retryable: false,
      };
    }
    if (error.status === 404) {
      return { code: "not-found", message: error.message, retryable: false };
    }
    if (error.status === 429 || error.status >= 500) {
      return { code: "blocked", message: error.message, retryable: true };
    }
    return { code: "network-error", message: error.message, retryable: true };
  }
  return {
    code: "network-error",
    message: error instanceof Error ? error.message : "Miruro request failed",
    retryable: true,
  };
}

/**
 * One request, short on purpose: it runs on every accepted candidate, and its
 * only job is to catch a backend host that is down before mpv is handed it.
 */
const MIRURO_BACKEND_PROBE_TIMEOUT_MS = 2_000;

/**
 * HTTP statuses that mean the backend behind a Miruro server cannot serve this
 * stream — gone, down, or refusing everyone — as opposed to refusing this
 * particular client.
 *
 * Deliberately narrow, because a status a CDN returns only to a non-player is a
 * working server this would otherwise skip:
 *
 * - 401/403 — owocdn behind kwik (`kiwi`) answers Bun's fetch with 403 while
 *   mpv plays the same URL.
 * - plain 500 — AnimeGG (`moo`, the most reliable backend) redirects to a
 *   vidcache host that answers `{"error":"Invalid request (bad hand off)"}` with
 *   500 to anything that is not its player, including a bare ranged GET. mpv
 *   plays those URLs.
 *
 * 429 is here, unlike 401/403, because a rate-limited master is refused to
 * everyone: on 2026-09-12 `pewe`'s hls.anidb.app answered 429 to mpv, to curl
 * with the stream's headers, and to curl with none, so the release signoff's
 * anime lane resolved a stream no player could open. Accepting it costs a failed
 * play and a slow recovery on the default anime provider; rejecting it costs one
 * more server attempt.
 */
export function isMiruroBackendDownStatus(status: number): boolean {
  return (
    status === 404 ||
    status === 410 ||
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

/**
 * Whether a response came back from the host that was asked. An empty or
 * unparseable `response.url` (some fetch implementations and every mocked
 * Response) counts as same-host, so a missing field can never turn into a
 * rejection.
 */
function isSameHost(requestedUrl: string, responseUrl: string | undefined): boolean {
  if (!responseUrl) return true;
  try {
    return new URL(requestedUrl).host === new URL(responseUrl).host;
  } catch {
    return true;
  }
}

/**
 * The status that proves a backend down, or `null` when there is no such proof.
 *
 * This only ever rejects; it never attests a stream as verified. A fetch that
 * succeeds says little about whether mpv will — Videasy's resolve gate got 200
 * from URLs mpv could not open (issue #361) — so a pass here is not evidence of
 * playability, only the absence of evidence of death.
 */
/**
 * Stream hosts this probe cannot judge from Bun, so it does not ask them.
 *
 * AnimeGG's `/play` (every `moo` stream) never answers Bun's fetch — it hung
 * past a 6s timeout on 2026-09-12, redirect followed or not, while curl and mpv
 * got a 302 at once. The probe returns null on a timeout, so asking only ever
 * spent the full `MIRURO_BACKEND_PROBE_TIMEOUT_MS` to learn nothing, on every
 * resolve that landed on Moo — the backend that plays now that `pewe` is down.
 * AnimeGG's own dossier already says a probe cannot judge these streams.
 */
const MIRURO_UNPROBEABLE_STREAM_HOSTS: ReadonlySet<string> = new Set([
  "www.animegg.org",
  "animegg.org",
]);

export async function probeMiruroBackendDown(
  url: string,
  headers: Readonly<Record<string, string>> | undefined,
  context: Pick<ProviderRuntimeContext, "fetch">,
  signal?: AbortSignal,
  /** Out-param: the response's Retry-After hint, when it carried one. */
  hintOut?: { retryAfterMs?: number },
): Promise<number | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  if (MIRURO_UNPROBEABLE_STREAM_HOSTS.has(new URL(url).hostname)) return null;
  const requester = context.fetch?.fetch.bind(context.fetch) ?? fetch;
  const timeout = AbortSignal.timeout(MIRURO_BACKEND_PROBE_TIMEOUT_MS);
  try {
    const response = await requester(url, {
      method: "GET",
      headers: { ...headers, Range: "bytes=0-0" },
      signal: signal ? anySignal(signal, timeout) : timeout,
    });
    void response.body?.cancel().catch(() => {});
    // A redirect to another host means the backend answered and handed us on;
    // what the CDN then says about one odd request is not evidence about the
    // backend. AnimeGG hands off to vidcache, which 500s anything but its player.
    if (!isSameHost(url, response.url)) return null;
    if (!isMiruroBackendDownStatus(response.status)) return null;
    if (hintOut) {
      hintOut.retryAfterMs = parseRetryAfterHeader(response.headers.get("retry-after"));
    }
    return response.status;
  } catch {
    // A timeout or connection error is as likely to be this client's network as
    // the backend's, and being offline must not read as "every server is dead".
    return null;
  }
}

/**
 * Mirrors `contentTypeFromAniListFormat` in the CLI's domain layer, which this
 * package cannot import. A one-shot OVA/SPECIAL/TV_SHORT/MUSIC is a film; TV and
 * ONA stay series even with one episode aired; unknown stays series.
 */
const ANILIST_ONE_SHOT_FORMATS = new Set(["OVA", "SPECIAL", "TV_SHORT", "MUSIC"]);

function miruroSearchContentType(
  format: string | null | undefined,
  episodes: number | null | undefined,
): "movie" | "series" {
  const normalized = format?.trim().toUpperCase();
  if (normalized === "MOVIE") return "movie";
  if (normalized && ANILIST_ONE_SHOT_FORMATS.has(normalized) && episodes === 1) return "movie";
  return "series";
}

function stripSearchDescription(value: string | null | undefined): string {
  let text = (value ?? "").replace(/<br\s*\/?>/gi, " ");
  // Strip tags to a fixpoint: one pass over `<<script>script>` leaves a
  // re-formed `<script>` behind, so pass until nothing changes.
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, "");
  } while (text !== previous);
  return (
    text
      // `&amp;` decodes last: decoding it first would let `&amp;quot;` or
      // `&amp;#39;` double-unescape into a quote the author deliberately hid.
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&amp;/g, "&")
      // After every decode, a lone bracket can only be a truncated tag remnant;
      // real descriptions write them as &lt;/&gt;, which this deliberately
      // never decodes. Nothing after this line can put a bracket back.
      .replace(/[<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240)
  );
}

function firstMiruroExternalId(ids: readonly string[] | undefined): string | undefined {
  const value = ids?.[0]?.trim();
  return value ? value : undefined;
}

/**
 * Catalog `/v1/anime` row → provider search result with exactly the identity
 * the AniList search service produces — `id` is the bare AniList id and
 * `externalIds.anilistId` carries it — so a show found here and the same show
 * found through AniList are one title in history, not two.
 *
 * Rows without an AniList id are dropped: `resolveMiruroAnilistId` is how
 * resolve finds the title again, so a result it cannot name would dead-end
 * after selection. Filters match the AniList service's query (`type:ANIME`,
 * `isAdult:false`, `status_not:NOT_YET_RELEASED`) — a missing or ignored
 * upstream filter would leak manga and novels into an anime picker, so it is
 * enforced here as well.
 */
export function mapMiruroCatalogAnime(anime: MiruroCatalogAnime): ProviderSearchResult | null {
  const externalIds = anime.external_ids;
  const anilistId = firstMiruroExternalId(externalIds?.anilist);
  if (!anilistId) return null;
  if (anime.is_adult === true) return null;
  if (anime.status === "NOT_YET_RELEASED") return null;

  const english = anime.title?.english?.trim() || undefined;
  const romaji = anime.title?.romaji?.trim() || undefined;
  const native = anime.title?.native?.trim() || undefined;
  const title = english ?? romaji ?? native;
  if (!title) return null;

  const malId = firstMiruroExternalId(externalIds?.mal);
  const posterUrl =
    anime.cover_image?.extra_large?.trim() || anime.cover_image?.large?.trim() || undefined;
  const year = anime.season_year ?? undefined;
  const episodeCount =
    isJsonNumber(anime.episode_count) && anime.episode_count > 0 ? anime.episode_count : undefined;
  const altNames = romaji && romaji !== title ? [romaji] : [];

  return {
    id: anilistId,
    type: miruroSearchContentType(anime.format, anime.episode_count ?? null),
    title,
    ...(year ? { year: String(year) } : null),
    overview: stripSearchDescription(anime.description),
    posterPath: posterUrl ?? null,
    // The catalog is AniList-bridged upstream (external_ids), so declaring the
    // source lets search routing skip a redundant AniList enrichment pass.
    metadataSource: "AniList",
    rating: isJsonNumber(anime.average_score) ? anime.average_score / 10 : null,
    popularity: isJsonNumber(anime.popularity) ? anime.popularity : null,
    ...(episodeCount ? { episodeCount } : null),
    ...(isJsonNumber(anime.episode_duration_minutes) && anime.episode_duration_minutes > 0
      ? { durationSeconds: anime.episode_duration_minutes * 60 }
      : null),
    ...(english && english !== title ? { englishTitle: english } : null),
    ...(native ? { nativeTitle: native } : null),
    ...(altNames.length > 0 ? { altNames } : null),
    externalIds: { anilistId, ...(malId ? { malId } : null) },
    ...(posterUrl || anime.banner_image
      ? {
          artwork: {
            ...(posterUrl ? { posterUrl, thumbnailUrl: posterUrl } : null),
            ...(anime.banner_image ? { backdropUrl: anime.banner_image } : null),
          },
        }
      : null),
  };
}

/**
 * Synthesize the `MiruroSourcesResponse` one cycle candidate feeds
 * `createMiruroResultFromPayload`, from the play matrix's provider+server cell.
 * The catalog shape is a superset of the old pipe's: per-server `Referer`
 * headers land on `stream.referer`, which the payload builder already turns
 * into the stream's request headers.
 */
function synthesizeMiruroSourceData(
  provider: MiruroCatalogProvider,
  server: MiruroCatalogServer,
  play: MiruroCatalogPlayResponse,
): MiruroSourcesResponse {
  const referer = server.headers?.["Referer"] ?? server.headers?.["referer"];
  const streams: MiruroStream[] = (server.streams ?? []).flatMap((stream) => {
    if (!isJsonString(stream.url) || stream.url.length === 0) return [];
    return [
      {
        url: stream.url,
        type: stream.format === "mp4" ? "mp4" : "hls",
        quality: stream.quality ?? undefined,
        referer: referer ?? undefined,
        resolution: stream.resolution ?? undefined,
        codec: stream.codec ?? undefined,
      },
    ];
  });

  // skip_times kinds follow the site's own mapping: `op*` → intro, `ed*` → outro.
  let intro: { readonly start: number; readonly end: number } | undefined;
  let outro: { readonly start: number; readonly end: number } | undefined;
  for (const segment of play.skip_times ?? []) {
    const start = segment.start_seconds;
    const end = segment.end_seconds;
    if (!isJsonNumber(start) || !isJsonNumber(end)) continue;
    if (segment.kind?.includes("op")) intro = { start, end };
    else if (segment.kind?.includes("ed")) outro = { start, end };
  }

  return {
    streams,
    subtitles: (provider.subtitles ?? []).map((subtitle) => ({
      url: subtitle.url ?? subtitle.file,
      label: subtitle.label,
      language: subtitle.language,
    })),
    thumbnails: provider.thumbnails ?? undefined,
    intro,
    outro,
    download: provider.downloads?.find((entry) => isJsonString(entry.url))?.url,
  };
}

type MiruroPlaySynthesis = {
  readonly providers: Record<string, MiruroProviderEntry>;
  readonly sourceDataByKey: ReadonlyMap<string, MiruroSourcesResponse>;
};

/**
 * The play matrix in the shape `buildMiruroCycleCandidates` consumes: one
 * provider entry per (provider, server) lane that actually carries direct
 * streams for the episode. Embed-only lanes are dropped here — the pipe used
 * to return them and let each one fail downstream, which is how dead backends
 * spent cycle budget.
 */
function synthesizeMiruroPlayProviders(
  play: MiruroCatalogPlayResponse,
  episodeNum: number,
  catalogEpisodeId: string,
): MiruroPlaySynthesis {
  const providers: Record<string, MiruroProviderEntry> = {};
  const sourceDataByKey = new Map<string, MiruroSourcesResponse>();
  const episodeEntry: MiruroEpisodeEntry = { id: catalogEpisodeId, number: episodeNum };

  for (const track of play.tracks ?? []) {
    const audioCategory: MiruroAudioCategory | null =
      track.track === "sub" || track.track === "ssub"
        ? "sub"
        : track.track === "dub"
          ? "dub"
          : null;
    if (!audioCategory) continue;
    for (const provider of track.providers ?? []) {
      for (const server of provider.servers ?? []) {
        if (!isJsonString(server.server) || server.server.length === 0) continue;
        const sourceData = synthesizeMiruroSourceData(provider, server, play);
        if (sourceData.streams?.length === 0) continue;
        const serverId = server.server;
        const key = `${serverId}|${audioCategory}`;
        const existing = providers[serverId];
        providers[serverId] = {
          episodes: {
            sub: audioCategory === "sub" ? [episodeEntry] : (existing?.episodes?.sub ?? undefined),
            dub: audioCategory === "dub" ? [episodeEntry] : (existing?.episodes?.dub ?? undefined),
          },
        };
        if (!sourceDataByKey.has(key)) sourceDataByKey.set(key, sourceData);
      }
    }
  }

  return { providers, sourceDataByKey };
}

export const miruroProviderModule: CoreProviderModule = {
  providerId: MIRURO_PROVIDER_ID,
  manifest: miruroManifest,
  /**
   * Search through Miruro's own catalog, so the anime lane can find titles when
   * AniList's API is unavailable (disabled outright on 2026-09-10).
   *
   * Every failure returns `null` rather than throwing, and that is the contract
   * that matters: `searchTitles` treats a null or empty provider search as "fall
   * through to the compatible catalog", which is AniList. Throwing would abort
   * the search and lose that fallback, turning one dead dependency into two.
   */
  async search(input, context) {
    const query = input.query.trim();
    if (!query) return null;
    try {
      const media = await searchMiruroCatalog(context, query, context.signal);
      const results = media
        .map(mapMiruroCatalogAnime)
        .filter((result): result is ProviderSearchResult => result !== null);
      return results.length > 0 ? results : null;
    } catch (error) {
      // Still null — that is the fallback contract — but not silent. Without
      // this the search router records the AniList fallback as a plain success,
      // and a Miruro search that is broken for everyone looks like it never ran.
      context.emit?.({
        type: "source:failed",
        at: context.now(),
        providerId: MIRURO_PROVIDER_ID,
        sourceId: "source:miruro:search",
        message: `Miruro search failed; falling back to the compatible catalog: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return null;
    }
  },
  async listEpisodes(input, context) {
    const anilistId = resolveMiruroAnilistId(input.title);
    if (!anilistId) return null;
    return fetchMiruroEpisodeCatalog(context, anilistId, context.signal);
  },
  async resolve(input, context) {
    if (input.mediaKind !== "anime") {
      return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
        code: "unsupported-title",
        message: "Miruro resolver only supports anime",
        retryable: false,
      });
    }

    if (!input.allowedRuntimes.includes("direct-http")) {
      return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
        code: "runtime-missing",
        message: "Miruro resolver requires direct-http runtime",
        retryable: false,
      });
    }

    const anilistId = resolveMiruroAnilistId(input.title);
    if (!anilistId) {
      return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
        code: "unsupported-title",
        message: "Miruro resolver requires a numeric AniList ID",
        retryable: false,
      });
    }

    const episodeNum = selectProviderEpisodeNumber(input.episode);
    const startedAt = context.now();
    const events: ProviderTraceEvent[] = [];
    const failures: ProviderFailure[] = [];

    emitTraceEvent(events, context, {
      type: "provider:start",
      providerId: MIRURO_PROVIDER_ID,
      message: "Started Miruro resolution",
    });

    const cachePolicy = createProviderCachePolicy({
      providerId: MIRURO_PROVIDER_ID,
      title: input.title,
      episode: input.episode,
      subtitleLanguage: input.preferredSubtitleLanguage,
      qualityPreference: input.qualityPreference,
      startupPriority: input.startupPriority,
    });

    // The catalog play call is one request for the whole matrix: tracks,
    // providers, servers, direct streams, subtitles, downloads. It replaced
    // the per-server sources calls the pipe needed — its latency is the
    // number worth attributing, inclusive of failure.
    const playStartedAt = performance.now();
    let playStageEmitted = false;
    const emitPlayStage = (laneCount: number, failed: boolean) => {
      playStageEmitted = true;
      emitTraceEvent(events, context, {
        type: failed ? "source:failed" : "source:success",
        providerId: MIRURO_PROVIDER_ID,
        sourceId: "source:miruro:play",
        message: "Fetched Miruro play catalog",
        durationMs: performance.now() - playStartedAt,
        attributes: { lanes: laneCount },
      });
    };

    try {
      const anime = await getMiruroCatalogAnime(context, anilistId, context.signal);
      if (!anime) {
        emitPlayStage(0, true);
        return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
          code: "not-found",
          message: `No Miruro catalog entry for AniList ID ${anilistId}`,
          retryable: true,
        });
      }
      const catalogEpisodeId = `${anime.id}:${episodeNum}`;
      const play = await fetchMiruroPlay(context, anime.id, episodeNum, context.signal);
      const { providers, sourceDataByKey } = synthesizeMiruroPlayProviders(
        play,
        episodeNum,
        catalogEpisodeId,
      );
      const laneCount = Object.keys(providers).length;
      emitPlayStage(laneCount, laneCount === 0);
      if (laneCount === 0) {
        return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
          code: "not-found",
          message: `No Miruro play data for episode ${episodeNum}`,
          retryable: true,
        });
      }

      const targetAudio: MiruroAudioCategory = resolveAnimeAudioIntent(
        input.preferredAudioLanguage ?? input.preferredPresentation ?? "original",
      ).catalogMode;
      const fallbackAudio = targetAudio === "dub" ? "sub" : "dub";
      const availableModes = collectMiruroAvailableAudioModes(providers, episodeNum);
      if (availableModes.length > 0) {
        emitTraceEvent(events, context, {
          type: "inventory:audio-modes",
          providerId: MIRURO_PROVIDER_ID,
          message: `Episode catalog exposes ${availableModes.join(" and ")} audio modes`,
          attributes: { modes: availableModes.join(",") },
        });
      }
      const cycleCandidates = buildMiruroCycleCandidates({
        providers,
        episodeNum,
        targetAudio,
        fallbackAudio,
        preferredSourceId: input.preferredSourceId,
        // Ranks servers whose subtitle delivery matches ahead of the others
        // within the requested audio; it never outranks the audio itself. The
        // adapter sets this to "hardcoded" for anime; `external` has no Miruro
        // equivalent, so it maps to `unknown`, which ranks nothing.
        preferredSubtitleDelivery:
          input.preferredSubtitleDelivery === "external"
            ? "unknown"
            : input.preferredSubtitleDelivery,
      });
      const sourceInventorySeeds = buildMiruroSourceInventoryCandidates(
        cycleCandidates,
        cachePolicy,
      );
      if (cycleCandidates.length === 0) {
        return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
          code: "not-found",
          message: `No ${targetAudio} episodes available`,
          retryable: true,
        });
      }

      const cycleStartedAt = performance.now();
      const cycleResult = await runProviderCycle({
        providerId: MIRURO_PROVIDER_ID,
        candidates: cycleCandidates,
        signal: context.signal,
        now: context.now,
        emit: context.emit,
        // Skips a server whose backend is quarantined, so a dead one costs a
        // probe for its first few plays instead of on every episode. The keys
        // are server ids (`animepahe`, `icarus-1-1`): sub and dub share a backend.
        endpointHealth: context.endpointHealth,
        titleId: input.title.id,
        maxAttemptsPerCandidate: 1,
        candidateTimeoutMs: providerCycleCandidateTimeoutMs(
          input.startupPriority ?? "balanced",
          MIRURO_CANDIDATE_TIMEOUT_MS,
        ),
        // No early stop: every lane's streams came from the one play call, so a
        // per-lane failure is endpoint evidence only. A region-wide catalog
        // block surfaces at the play fetch above and never reaches the cycle.
        resolveCandidate: async (candidate, cycleContext) => {
          const metadata = parseMiruroCycleCandidateMetadata(candidate, context);
          const serverProfile = createMiruroServerProfile(
            metadata.serverId,
            metadata.audioCategory,
          );
          // The play matrix already returned this lane's streams — the pipe
          // needed a second call per server, the catalog does not.
          const srcData = sourceDataByKey.get(`${metadata.serverId}|${metadata.audioCategory}`);

          const rawStreams =
            srcData?.streams?.filter((s) => (s.type === "hls" || s.type === "mp4") && s.url) ?? [];
          if (rawStreams.length === 0) {
            throw createProviderCycleFailureError(candidate, {
              failureClass: "candidate-empty",
              message:
                `${serverProfile.label} ` +
                `(${metadata.serverId}/${metadata.audioCategory}) returned no playable streams`,
              retryable: true,
              at: context.now(),
            });
          }

          const result = await createMiruroResultFromPayload({
            input,
            sourceData: srcData ?? {},
            audioCategory: metadata.audioCategory,
            serverProfile,
            cachePolicy,
            context,
            startedAt,
            events,
            failures,
          });
          if (!result) {
            throw createProviderCycleFailureError(candidate, {
              failureClass: "candidate-empty",
              message:
                `${serverProfile.label} ` +
                `(${metadata.serverId}/${metadata.audioCategory}) did not produce a selectable stream`,
              retryable: true,
              at: context.now(),
            });
          }

          // The catalog hands out a backend's URL whether or not that backend is up:
          // `pewe` kept returning hls.anidb.app URLs through AniDB's maintenance.
          // Without this check the first such server wins the cycle and mpv is
          // handed a dead host while healthy servers go untried.
          const selected =
            result.streams.find((stream) => stream.id === result.selectedStreamId) ??
            result.streams[0];
          // oxlint-disable-next-line anti-slop/no-known-value-widening -- open slot: retryAfterMs is attached only when the probe answers 429
          const probeHint: { retryAfterMs?: number } = {};
          const downStatus = selected?.url
            ? await probeMiruroBackendDown(
                selected.url,
                selected.headers,
                context,
                cycleContext.signal,
                probeHint,
              )
            : null;
          if (downStatus !== null) {
            // The engine records nothing for `candidate-empty` — rightly, since
            // an episode with no dub must not quarantine a server — so this
            // definitive backend status is recorded here instead. A timeout or
            // an aborted probe returns null above and never reaches this line.
            context.endpointHealth?.recordFailure(MIRURO_PROVIDER_ID, metadata.serverId, {
              class: "server-error",
              titleId: input.title.id,
              at: context.now(),
              retryAfterMs: probeHint.retryAfterMs,
            });
            throw createProviderCycleFailureError(candidate, {
              // Not `candidate-network`: retryable schedules a retry of a host
              // that is still down, and non-retryable stops the whole cycle as
              // offline. This server simply has nothing playable right now.
              failureClass: "candidate-empty",
              message:
                `${serverProfile.label} ` +
                `(${metadata.serverId}/${metadata.audioCategory}) backend unavailable: HTTP ${downStatus}`,
              retryable: true,
              at: context.now(),
            });
          }

          return result;
        },
      });

      if (cycleResult.cancelled) {
        events.push(...cycleResult.events);
        return createExhaustedResult(
          input,
          context,
          MIRURO_PROVIDER_ID,
          {
            code: "cancelled",
            message: "Miruro source cycling was cancelled",
            retryable: false,
          },
          {
            cachePolicy,
            events,
            failures,
            sources: finalizeCycleSourceInventory({
              sources: sourceInventorySeeds,
              attempts: cycleResult.attempts,
            }),
            startedAt,
          },
        );
      }

      if (!cycleResult.selected) {
        events.push(...cycleResult.events);
        return cycleExhaustedResult({
          input,
          context,
          providerId: MIRURO_PROVIDER_ID,
          attempts: cycleResult.attempts,
          fallback: {
            code: "not-found",
            message: "No HLS streams from Miruro sources",
            retryable: true,
          },
          evidence: {
            cachePolicy,
            events,
            failures,
            sources: finalizeCycleSourceInventory({
              sources: sourceInventorySeeds,
              attempts: cycleResult.attempts,
            }),
            startedAt,
          },
        });
      }

      emitTraceEvent(events, context, {
        type: "source:success",
        providerId: MIRURO_PROVIDER_ID,
        sourceId: "source:miruro:source-cycle",
        message: "Resolved a Miruro source",
        durationMs: performance.now() - cycleStartedAt,
      });

      // Miruro tries the fallback audio when the requested one has no working
      // server. That downgrade was silent, so the shell could not tell the user
      // they asked for a dub and got a sub. Emit a typed event whenever the
      // resolved presentation differs from what was requested.
      const selected = cycleResult.selected;
      const resolvedPresentation = selected.streams.find(
        (stream) => stream.id === selected.selectedStreamId,
      )?.presentation;
      if (isMiruroAudioFallback(targetAudio, resolvedPresentation)) {
        emitTraceEvent(events, context, {
          type: "audio:fallback",
          providerId: MIRURO_PROVIDER_ID,
          message: `Requested ${targetAudio} audio was unavailable; resolved ${String(resolvedPresentation)}`,
          attributes: { requested: targetAudio, resolved: String(resolvedPresentation) },
        });
      }

      emitTraceEvent(events, context, {
        type: "provider:success",
        providerId: MIRURO_PROVIDER_ID,
        message: `Resolved Miruro stream for AniList ID ${anilistId}`,
      });

      return appendCycleEventsToResult(
        {
          ...cycleResult.selected,
          sources: finalizeCycleSourceInventory({
            sources: sourceInventorySeeds,
            attempts: cycleResult.attempts,
            selectedSources: cycleResult.selected.sources ?? [],
            streams: cycleResult.selected.streams,
            selectedStreamId: cycleResult.selected.selectedStreamId,
          }),
        },
        cycleResult.events,
      );
    } catch (error) {
      if (context.signal?.aborted) {
        return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
          code: "cancelled",
          message: "Miruro resolution was cancelled",
          retryable: false,
        });
      }

      // A throw from the lookup or play fetch skipped the stage event — the
      // fetch is where the time went, so its failure must still be timed.
      if (!playStageEmitted) emitPlayStage(0, true);
      const classified = classifyMiruroResolveError(error);
      failures.push({
        providerId: MIRURO_PROVIDER_ID,
        ...classified,
        at: context.now(),
      });

      return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, classified);
    }
  },
};
