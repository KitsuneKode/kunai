import {
  createProviderCycleFailureError,
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  runProviderCycle,
  type CoreProviderModule,
} from "@kunai/core";
import type {
  CachePolicy,
  ProviderCycleCandidate,
  ProviderEpisodeListInput,
  ProviderEpisodeOption,
  ProviderFailure,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderSourceCandidate,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
  SubtitleCandidate,
} from "@kunai/types";

import { miruroInventorySourceId } from "../catalogs/miruro";
import { providerFetch } from "../runtime/fetch";
import { resolveAnimeAudioIntent } from "../shared/anime-audio-intent";
import {
  type AnimeEpisodeMetadata,
  fetchAnimeEpisodeMetadataByNumber,
  formatAnimeEpisodeLabel,
  mergeMiruroPipeEpisodeMetadata,
  shouldSkipExternalEpisodeMetadataEnrichment,
} from "../shared/anime-metadata";
import { TTLCache } from "../shared/provider-cache";
import {
  appendCycleEventsToResult,
  findLastCycleFailure,
  providerFailureCodeFromCycleFailure,
} from "../shared/provider-cycle";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import { finalizeCycleSourceInventory } from "../shared/source-inventory";
import { selectReadyStream } from "../shared/startup-selection";
import { normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import { miruroManifest, MIRURO_PROVIDER_ID } from "./manifest";

export { MIRURO_PROVIDER_ID };
export const MIRURO_REFERER = "https://miruro.bz/";
export const MIRURO_PIPE_BASE_URLS = [
  "https://miruro.bz",
  "https://miruro.ru",
  "https://miruro.tv",
  "https://www.miruro.tv",
] as const;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PIPE_KEY = "71951034f8fbcf53d89db52ceb3dc22c";

/** Cache episode lists per AniList ID. TTL 30 minutes (episode data is stable). */
const episodeCache = new TTLCache<string, unknown>(1_800_000);
/** Cache source responses per episode+category. TTL 5 minutes. */
const sourceCache = new TTLCache<string, unknown>(300_000);

type MiruroPipeStream = {
  readonly url?: string;
  readonly type?: "hls" | "embed";
  readonly quality?: string;
  readonly referer?: string;
  readonly resolution?: { readonly width?: number; readonly height?: number };
  readonly codec?: string;
  readonly audio?: string;
  readonly fansub?: string;
  readonly isActive?: boolean;
};

type MiruroSourcesResponse = {
  readonly streams?: readonly MiruroPipeStream[];
  readonly subtitles?: readonly MiruroPipeSubtitle[];
  readonly thumbnails?: readonly MiruroPipeThumbnail[];
  readonly intro?: { readonly start: number; readonly end: number };
  readonly outro?: { readonly start: number; readonly end: number };
  readonly download?: string;
};

type MiruroPipeSubtitle = {
  readonly url?: string;
  readonly file?: string;
  readonly lang?: string;
  readonly language?: string;
  readonly label?: string;
};

type MiruroPipeThumbnail = {
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

const MIRURO_PROVIDER_LABELS: Record<string, string> = {
  kiwi: "Kiwi",
  bee: "Bee",
  ANIMEKAI: "AnimeKai",
  ANIMEZ: "AnimeZ",
  hop: "Hop",
  ZORO: "Zoro",
  ally: "Ally",
  dune: "Dune",
  // Servers observed live 2026-06-07 (see miruro research report) — without a
  // label they render as the raw key. The candidate builder already iterates
  // every server in the episodes `providers` map, so these just need names.
  pewe: "Pewe",
  moo: "Moo",
  bonk: "Bonk",
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
  readonly meta?: Record<string, unknown>;
  readonly episodes?: MiruroProviderEpisodes;
};

type MiruroEpisodesResponse = {
  readonly mappings?: Record<string, unknown>;
  readonly providers?: Record<string, MiruroProviderEntry | undefined>;
};

type MiruroCycleCandidateMetadata = {
  readonly audioCategory: MiruroAudioCategory;
  readonly episodeId: string;
  readonly serverId: MiruroServerKey;
  readonly subtitleDelivery: MiruroSubtitleDelivery;
};

function base64urlToBytes(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createMiruroPipeRequestUrls(encodedPayload: string): string[] {
  return MIRURO_PIPE_BASE_URLS.map((baseUrl) => `${baseUrl}/api/secure/pipe?e=${encodedPayload}`);
}

export function createMiruroResultFromPayload({
  input,
  sourceData,
  audioCategory,
  serverProfile,
  cachePolicy,
  context,
  startedAt,
  events = [],
  failures = [],
}: MiruroResolvePayloadOptions): ProviderResolveResult | null {
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
  const rawStreams = rankMiruroStreams(
    sourceData.streams?.filter((s) => s.type === "hls" && s.url) ?? [],
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
  const subtitleDelivery = subtitlePresentation.subtitleDelivery;
  const playbackHost = resolveMiruroPlaybackHost(rawStreams[0]?.url);
  const flavorArchetype = `${resolvedServerProfile.label} · Miruro`;

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
    const qualityStr = miruroQualityLabel(raw);
    const qualityRank = qualityRankFromMiruroStream(raw);
    const streamId = `stream:${MIRURO_PROVIDER_ID}:${Bun.hash(raw.url).toString(36)}`;
    const variantId = `variant:${MIRURO_PROVIDER_ID}:${sourceId}:${qualityStr}`;
    const streamReferer = raw.referer || MIRURO_REFERER;
    const streamSubtitleDelivery =
      subtitleDelivery === "unknown"
        ? undefined
        : (subtitleDelivery as "hardcoded" | "embedded" | "external");

    streams.push({
      id: streamId,
      providerId: MIRURO_PROVIDER_ID,
      sourceId,
      variantId,
      url: raw.url,
      protocol: "hls",
      container: "m3u8",
      audioLanguages: audioCategory === "sub" ? ["ja"] : ["en"],
      presentation: audioCategory,
      hardSubLanguage: resolvedServerProfile.hardSubLanguage,
      subtitleDelivery: streamSubtitleDelivery,
      subtitleLanguages: subtitlePresentation.subtitleLanguages,
      serverName: resolvedServerProfile.label,
      flavorArchetype,
      flavorLabel: displaySourceLabel,
      qualityLabel: qualityStr,
      qualityRank,
      languageEvidence,
      sourceEvidence,
      artwork,
      headers: {
        referer: streamReferer,
        "user-agent": USER_AGENT,
      },
      confidence: 0.95,
      cachePolicy: policy,
      ...(timingMetadata ? { metadata: timingMetadata } : {}),
    });

    variants.push({
      id: variantId,
      providerId: MIRURO_PROVIDER_ID,
      sourceId,
      qualityLabel: qualityStr,
      qualityRank,
      protocol: "hls",
      container: "m3u8",
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

  variants.sort((a, b) => (b.qualityRank || 0) - (a.qualityRank || 0));
  const selectableStreams = streams.slice(0, 1);
  const selection = selectReadyStream(selectableStreams, {
    startupPriority: input.startupPriority,
    qualityPreference: input.qualityPreference,
    preferredStreamId: input.preferredStreamId,
    preferredSourceId: input.preferredSourceId,
    favoriteSourceNames: input.favoriteSourceNames,
  });
  const selectedStream = selection.selected;

  const endedAt = context?.now() ?? new Date().toISOString();
  return {
    status: "resolved",
    providerId: MIRURO_PROVIDER_ID,
    selectedStreamId: selectedStream.id,
    selectionDecision: selection.decision,
    sources: [
      {
        id: sourceId,
        providerId: MIRURO_PROVIDER_ID,
        kind: "provider-api",
        label: displaySourceLabel,
        host: "www.miruro.tv",
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
          flavorArchetype: `${serverProfile.label} · Miruro`,
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
        createTraceStep("provider", "Resolved Miruro through pipe API", {
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
  subtitles: readonly MiruroPipeSubtitle[] | undefined,
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
        format: url.endsWith(".vtt") ? ("vtt" as const) : ("srt" as const),
        source: "provider" as const,
        confidence: 0.9,
        cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" as const },
      },
    ];
  });
}

function firstMiruroThumbnailUrl(
  thumbnails: readonly MiruroPipeThumbnail[] | undefined,
): string | undefined {
  const thumbnail = thumbnails?.find((entry) => entry.url || entry.file);
  return thumbnail?.url ?? thumbnail?.file;
}

function createMiruroTimingMetadata(
  sourceData: MiruroSourcesResponse,
): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = {};
  const intro = normalizeMiruroTimingSegment(sourceData.intro);
  const outro = normalizeMiruroTimingSegment(sourceData.outro);
  if (intro) metadata.intro = intro;
  if (outro) metadata.outro = outro;
  return Object.keys(metadata).length > 0 ? metadata : null;
}

function normalizeMiruroTimingSegment(
  segment: { readonly start: number; readonly end: number } | undefined,
): { readonly start: number; readonly end: number } | null {
  if (!segment) return null;
  if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end)) return null;
  if (segment.end <= segment.start) return null;
  return { start: segment.start, end: segment.end };
}

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
  let priority = 0;
  const defaultServers = ["kiwi", "bee", "hop", "ally", "pewe", "moo", "bonk"] as const;
  const providerEntries = providers
    ? Object.entries(providers)
    : defaultServers.map((server) => [server, { episodes }] as const);

  for (const audioCategory of audioOrder) {
    for (const [providerKey, providerEntry] of providerEntries) {
      const episodeEntry = findMiruroEpisodeEntry(
        providerEntry?.episodes?.[audioCategory],
        episodeNum,
      );
      if (!episodeEntry?.id) continue;
      const serverProfile = createMiruroServerProfile(providerKey);
      const sourceId = miruroInventorySourceId(serverProfile.id, audioCategory);
      const subtitlePriorityBoost =
        preferredSubtitleDelivery === "hardcoded" && audioCategory === "sub" ? -5_000 : 0;
      candidates.push({
        id: `candidate:${sourceId}:${audioCategory}:${episodeEntry.id}`,
        providerId: MIRURO_PROVIDER_ID,
        sourceId,
        serverId: serverProfile.id,
        groupId: audioCategory,
        label: displayMiruroSourceLabel(serverProfile, audioCategory),
        nativeLabel: serverProfile.label,
        normalizedAudioLanguage: audioCategory === "sub" ? "ja" : "en",
        normalizedSubtitleLanguage: serverProfile.hardSubLanguage,
        presentation: audioCategory,
        priority:
          (sourceId === preferredSourceId ? priority - 10_000 : priority) + subtitlePriorityBoost,
        metadata: {
          audioCategory,
          episodeId: episodeEntry.id,
          serverId: serverProfile.id,
          subtitleDelivery: serverProfile.subtitleDelivery,
        } satisfies MiruroCycleCandidateMetadata,
      });
      priority += 1;
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

    const metadata = candidate.metadata ?? {};
    const audioCategory = metadata.audioCategory === "dub" ? "dub" : "sub";
    const serverId = String(candidate.serverId ?? metadata.serverId ?? "");
    const subtitleDelivery =
      metadata.subtitleDelivery === "embedded" || metadata.subtitleDelivery === "hardcoded"
        ? metadata.subtitleDelivery
        : "unknown";
    const label = candidate.label ?? candidate.nativeLabel ?? sourceId;

    return [
      {
        id: sourceId,
        providerId: MIRURO_PROVIDER_ID,
        kind: "provider-api",
        label,
        host: "www.miruro.tv",
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
            nativeLabel: candidate.nativeLabel ?? serverId,
            host: "www.miruro.tv",
            confidence: 0.75,
            metadata: { audioCategory, subtitleDelivery },
          },
        ],
        metadata: {
          audioCategory,
          episodeId: metadata.episodeId,
          subtitleDelivery,
          server: serverId,
          nativeLabel: candidate.nativeLabel,
          flavorLabel: label,
          flavorArchetype: `${candidate.nativeLabel ?? serverId} · Miruro`,
        },
      },
    ];
  });
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
    typeof episodeId !== "string" ||
    typeof serverId !== "string" ||
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

function displayMiruroSourceLabel(
  serverProfile: MiruroServerProfile,
  audioCategory: MiruroAudioCategory,
): string {
  const audioLabel = audioCategory === "dub" ? "Dub" : "Sub";
  const subLabel =
    serverProfile.subtitleDelivery === "embedded"
      ? "soft sub"
      : serverProfile.subtitleDelivery === "hardcoded"
        ? "hard sub"
        : audioCategory === "dub"
          ? "no soft subs"
          : "subtitles unknown";
  return `${audioLabel} · ${serverProfile.label} · ${subLabel}`;
}

function createMiruroServerProfile(providerKey: string): MiruroServerProfile {
  return {
    id: providerKey,
    label: MIRURO_PROVIDER_LABELS[providerKey] ?? normalizeMiruroProviderLabel(providerKey),
    subtitleDelivery: "unknown",
  };
}

function normalizeMiruroProviderLabel(providerKey: string): string {
  const spaced = providerKey.replace(/[_-]+/g, " ").trim();
  if (!spaced) return "Unknown";
  return spaced.replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveMiruroSubtitlePresentation(
  audioCategory: MiruroAudioCategory,
  sourceData: MiruroSourcesResponse,
  preferredSubtitleLanguage?: string,
): {
  readonly subtitleDelivery: MiruroSubtitleDelivery;
  readonly hardSubLanguage?: string;
  readonly subtitleLanguages?: readonly string[];
  readonly includeExternalSubtitles: boolean;
} {
  const pipeSubtitles = (sourceData.subtitles ?? []).filter(
    (subtitle) => subtitle.url || subtitle.file,
  );
  if (pipeSubtitles.length > 0) {
    const subtitleLanguages = [
      ...new Set(
        pipeSubtitles
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

function miruroQualityLabel(stream: MiruroPipeStream): string {
  const quality = stream.quality?.trim();
  if (quality && quality !== "auto") return quality;
  const height = stream.resolution?.height;
  if (typeof height === "number" && height > 0) return `${height}p`;
  return "unknown";
}

function resolveMiruroPlaybackHost(streamUrl: string | undefined): string {
  if (!streamUrl) return "www.miruro.tv";
  try {
    return new URL(streamUrl).hostname;
  } catch {
    return "www.miruro.tv";
  }
}

function rankMiruroStreams(streams: readonly MiruroPipeStream[]): MiruroPipeStream[] {
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

function isMiruroCdnStream(stream: MiruroPipeStream): boolean {
  if (!stream.url) return false;
  try {
    const host = new URL(stream.url).hostname.toLowerCase();
    return host.includes("uwucdn") || host.includes("owocdn");
  } catch {
    return false;
  }
}

function qualityRankFromMiruroStream(stream: MiruroPipeStream): number {
  return parseInt(stream.quality ?? "") || stream.resolution?.height || 0;
}

function xorDecrypt(encrypted: Uint8Array, keyHex: string): Uint8Array {
  const parts = keyHex.match(/.{2}/g) ?? [];
  if (parts.length === 0) throw new Error("Invalid Miruro pipe key");
  const key = new Uint8Array(parts.map((b) => parseInt(b, 16)));
  const result = new Uint8Array(encrypted.length);
  for (let i = 0; i < encrypted.length; i++) {
    result[i] = (encrypted[i] ?? 0) ^ (key[i % key.length] ?? 0);
  }
  return result;
}

function resolveMiruroAnilistId(title: ProviderEpisodeListInput["title"]): string | null {
  const anilistId = title.anilistId ?? title.id.replace("anilist:", "");
  if (!anilistId || Number.isNaN(Number(anilistId))) return null;
  return anilistId;
}

/** Shared episode list fetch for listEpisodes + resolve (30m TTL). */
export async function getMiruroEpisodesResponse(
  context: ProviderRuntimeContext,
  anilistId: string,
  signal?: AbortSignal,
): Promise<MiruroEpisodesResponse | null> {
  const cacheKey = `episodes:${anilistId}`;
  const cached = episodeCache.get(cacheKey) as MiruroEpisodesResponse | null;
  if (cached) return cached;

  const epData = (await pipeCall(
    context,
    "episodes",
    { anilistId: Number(anilistId) },
    signal,
  )) as MiruroEpisodesResponse | null;
  if (epData) episodeCache.set(cacheKey, epData);
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

function readMiruroMappingMalId(mappings: Record<string, unknown> | undefined): string | undefined {
  const malId = mappings?.malId;
  if (typeof malId === "number" && malId > 0) return String(malId);
  if (typeof malId === "string" && malId.trim()) return malId.trim();
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
  mergeMiruroPipeEpisodeMetadata(metadata, entries);

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

async function pipeCall(
  context: ProviderRuntimeContext,
  path: string,
  query: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<unknown | null> {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) q[k] = String(v);

  const payload = { path, method: "GET" as const, query: q, body: null, version: "0.2.0" };
  const encoded = bytesToBase64url(new TextEncoder().encode(JSON.stringify(payload)));
  let lastError: unknown;
  let res: Response | null = null;

  for (const url of createMiruroPipeRequestUrls(encoded)) {
    const baseUrl = new URL(url).origin;
    try {
      const candidate = await providerFetch(context, url, {
        signal: signal ?? AbortSignal.timeout(20_000),
        headers: {
          "User-Agent": USER_AGENT,
          Referer: `${baseUrl}/`,
          Origin: baseUrl,
          Accept: "application/json, text/plain, */*",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        },
      });
      if (candidate.ok) {
        res = candidate;
        break;
      }
      lastError = new Error(`HTTP ${candidate.status}`);
    } catch (error) {
      lastError = error;
    }
  }

  if (!res) {
    const message = lastError instanceof Error ? lastError.message : "request failed";
    throw new Error(`Miruro pipe network request failed: ${message}`, { cause: lastError });
  }

  if (!res.ok) return null;

  const body = await res.text();
  if (!body.startsWith("bh4YNPj7") && res.headers.get("x-obfuscated") !== "2") return null;

  const raw = base64urlToBytes(body);
  const decrypted = xorDecrypt(raw, PIPE_KEY);
  let json: string;
  if (decrypted[0] === 31 && decrypted[1] === 139) {
    json = new TextDecoder().decode(Bun.gunzipSync(decrypted.buffer as ArrayBuffer));
  } else {
    json = new TextDecoder().decode(decrypted);
  }
  return JSON.parse(json);
}

export const miruroProviderModule: CoreProviderModule = {
  providerId: MIRURO_PROVIDER_ID,
  manifest: miruroManifest,
  async listEpisodes(input, context) {
    const anilistId = resolveMiruroAnilistId(input.title);
    if (!anilistId) return null;
    return fetchMiruroEpisodeCatalog(context, anilistId, context.signal);
  },
  async resolve(input, context) {
    if (input.mediaKind !== "anime") {
      return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
        code: "unsupported-title",
        message: "Miruro pipe resolver only supports anime",
        retryable: false,
      });
    }

    if (!input.allowedRuntimes.includes("direct-http")) {
      return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
        code: "runtime-missing",
        message: "Miruro pipe resolver requires direct-http runtime",
        retryable: false,
      });
    }

    const anilistId = input.title.anilistId ?? input.title.id.replace("anilist:", "");
    if (!anilistId || Number.isNaN(Number(anilistId))) {
      return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
        code: "unsupported-title",
        message: "Miruro pipe resolver requires a numeric AniList ID",
        retryable: false,
      });
    }

    const episodeNum = input.episode?.absoluteEpisode ?? input.episode?.episode ?? 1;
    const startedAt = context.now();
    const events: ProviderTraceEvent[] = [];
    const failures: ProviderFailure[] = [];

    emitTraceEvent(events, context, {
      type: "provider:start",
      providerId: MIRURO_PROVIDER_ID,
      message: "Started Miruro pipe resolution",
    });

    const cachePolicy = createProviderCachePolicy({
      providerId: MIRURO_PROVIDER_ID,
      title: input.title,
      episode: input.episode,
      subtitleLanguage: input.preferredSubtitleLanguage,
      qualityPreference: input.qualityPreference,
      startupPriority: input.startupPriority,
    });

    try {
      const epData = await getMiruroEpisodesResponse(context, anilistId, context.signal);
      if (!epData?.providers || Object.keys(epData.providers).length === 0) {
        return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
          code: "not-found",
          message: "No episode data from miruro pipe API",
          retryable: true,
        });
      }

      const targetAudio: MiruroAudioCategory = resolveAnimeAudioIntent(
        input.preferredAudioLanguage ?? input.preferredPresentation ?? "original",
      ).catalogMode;
      const fallbackAudio = targetAudio === "dub" ? "sub" : "dub";
      const cycleCandidates = buildMiruroCycleCandidates({
        providers: epData.providers,
        episodeNum,
        targetAudio,
        fallbackAudio,
        preferredSourceId: input.preferredSourceId,
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

      const cycleResult = await runProviderCycle({
        providerId: MIRURO_PROVIDER_ID,
        candidates: cycleCandidates,
        signal: context.signal,
        now: context.now,
        emit: context.emit,
        maxAttemptsPerCandidate: 1,
        candidateTimeoutMs: 20_000,
        resolveCandidate: async (candidate) => {
          const metadata = parseMiruroCycleCandidateMetadata(candidate, context);
          const serverProfile = createMiruroServerProfile(metadata.serverId);
          const srcCacheKey = `sources:${metadata.episodeId}:${metadata.audioCategory}:${metadata.serverId}`;
          let srcData = sourceCache.get(srcCacheKey) as MiruroSourcesResponse | null;
          if (!srcData) {
            srcData = (await pipeCall(
              context,
              "sources",
              {
                episodeId: metadata.episodeId,
                anilistId: Number(anilistId),
                provider: metadata.serverId,
                category: metadata.audioCategory,
              },
              context.signal,
            )) as MiruroSourcesResponse | null;
            if (srcData) sourceCache.set(srcCacheKey, srcData);
          }

          const rawStreams = srcData?.streams?.filter((s) => s.type === "hls" && s.url) ?? [];
          if (rawStreams.length === 0) {
            throw createProviderCycleFailureError(candidate, {
              failureClass: "candidate-empty",
              message:
                `${serverProfile.label} ` +
                `(${metadata.serverId}/${metadata.audioCategory}) returned no HLS streams`,
              retryable: true,
              at: context.now(),
            });
          }

          const result = createMiruroResultFromPayload({
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
        const cycleFailure = findLastCycleFailure(cycleResult.attempts);
        const failure = cycleFailure
          ? {
              code: providerFailureCodeFromCycleFailure(cycleFailure.failureClass),
              message: cycleFailure.message,
              retryable: cycleFailure.retryable,
            }
          : {
              code: "not-found" as const,
              message: "No HLS streams from miruro sources pipe",
              retryable: true,
            };
        return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, failure, {
          cachePolicy,
          events,
          failures,
          sources: finalizeCycleSourceInventory({
            sources: sourceInventorySeeds,
            attempts: cycleResult.attempts,
          }),
          startedAt,
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

      failures.push({
        providerId: MIRURO_PROVIDER_ID,
        code: "network-error",
        message: error instanceof Error ? error.message : "Miruro pipe API failed",
        retryable: true,
        at: context.now(),
      });

      return createExhaustedResult(input, context, MIRURO_PROVIDER_ID, {
        code: "network-error",
        message: error instanceof Error ? error.message : "Miruro pipe API failed",
        retryable: true,
      });
    }
  },
};
