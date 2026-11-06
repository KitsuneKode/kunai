import type { CachePolicy, StreamCandidate, SubtitleCandidate } from "@kunai/types";

import { normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import { invidiousGetVideo, type InvidiousVideoDetails } from "./invidious-client";
import { YOUTUBE_PROVIDER_ID } from "./manifest";

const INVIDIOUS_FALLBACK_SOURCE_ID = `source:${YOUTUBE_PROVIDER_ID}:invidious-fallback`;

let invidiousPlaybackFallbackEnabled = true;

/** Test seam: resolve fixture tests must not hit the public Invidious network. */
export function setInvidiousPlaybackFallbackEnabledForTest(enabled: boolean): void {
  invidiousPlaybackFallbackEnabled = enabled;
}

export type InvidiousPlaybackBundle = {
  readonly streams: readonly StreamCandidate[];
  readonly subtitles: readonly SubtitleCandidate[];
  readonly source: {
    readonly id: string;
    readonly label: string;
  };
};

function audioLanguagesFromDetails(details: InvidiousVideoDetails): readonly string[] {
  const langs = new Set<string>();
  for (const format of details.adaptiveFormats ?? []) {
    const fromTrack = format.audioTrack?.id?.split(".")[0];
    const normalized =
      normalizeIsoLanguageCode(fromTrack) ??
      normalizeIsoLanguageCode(format.language) ??
      (fromTrack?.length === 2 || fromTrack?.length === 3 ? fromTrack : undefined);
    if (normalized) langs.add(normalized);
  }
  if (langs.size === 0) langs.add("en");
  return [...langs];
}

export function invidiousStreamsFromVideoDetails(
  videoId: string,
  details: InvidiousVideoDetails,
  cachePolicy: CachePolicy,
  instanceUrl: string,
): InvidiousPlaybackBundle {
  const streams: StreamCandidate[] = [];
  const audioLanguages = audioLanguagesFromDetails(details);

  if (details.dashUrl) {
    streams.push({
      id: `stream:${YOUTUBE_PROVIDER_ID}:${videoId}:invidious:dash`,
      providerId: YOUTUBE_PROVIDER_ID,
      sourceId: INVIDIOUS_FALLBACK_SOURCE_ID,
      variantId: `variant:${YOUTUBE_PROVIDER_ID}:invidious:dash`,
      url: details.dashUrl,
      protocol: "dash",
      container: "mpd",
      qualityLabel: "1080p",
      qualityRank: 1080,
      serverName: "Invidious DASH",
      flavorLabel: "Invidious · DASH",
      requiresYtdl: false,
      headers: {},
      audioLanguages,
      confidence: 0.88,
      cachePolicy,
      metadata: {
        videoId,
        durationSeconds: details.lengthSeconds,
        isLive: details.liveNow === true,
        invidiousFallback: true,
      },
    });
  }

  if (details.hlsUrl) {
    streams.push({
      id: `stream:${YOUTUBE_PROVIDER_ID}:${videoId}:invidious:hls`,
      providerId: YOUTUBE_PROVIDER_ID,
      sourceId: INVIDIOUS_FALLBACK_SOURCE_ID,
      variantId: `variant:${YOUTUBE_PROVIDER_ID}:invidious:hls`,
      url: details.hlsUrl,
      protocol: "hls",
      container: "m3u8",
      qualityLabel: "720p",
      qualityRank: 720,
      serverName: "Invidious HLS",
      flavorLabel: "Invidious · HLS",
      requiresYtdl: false,
      headers: {},
      audioLanguages,
      confidence: 0.86,
      cachePolicy,
      metadata: {
        videoId,
        durationSeconds: details.lengthSeconds,
        isLive: details.liveNow === true,
        invidiousFallback: true,
      },
    });
  }

  const subtitles: SubtitleCandidate[] = [];
  for (const caption of details.captions ?? []) {
    const rawLang = caption.language_code ?? "en";
    const language = normalizeIsoLanguageCode(rawLang) ?? rawLang;
    const subUrl = caption.url
      ? caption.url.startsWith("http")
        ? caption.url
        : `${instanceUrl}${caption.url.startsWith("/") ? "" : "/"}${caption.url}`
      : "";
    if (!subUrl) continue;
    subtitles.push({
      id: `subtitle:${YOUTUBE_PROVIDER_ID}:${videoId}:invidious:${language}`,
      providerId: YOUTUBE_PROVIDER_ID,
      sourceId: INVIDIOUS_FALLBACK_SOURCE_ID,
      url: subUrl,
      language,
      label: caption.label ?? language,
      format: "vtt",
      source: "provider",
      confidence: 0.9,
      cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" },
    });
  }

  return {
    streams,
    subtitles,
    source: {
      id: INVIDIOUS_FALLBACK_SOURCE_ID,
      label: "Invidious direct (googlevideo fallback)",
    },
  };
}

export async function fetchInvidiousPlaybackFallback(
  videoId: string,
  cachePolicy: CachePolicy,
  options: {
    readonly preferredInstanceUrl?: string;
    readonly signal?: AbortSignal;
  },
): Promise<InvidiousPlaybackBundle | null> {
  if (!invidiousPlaybackFallbackEnabled) return null;
  try {
    const details = await invidiousGetVideo(videoId, {
      preferredInstanceUrl: options.preferredInstanceUrl,
      signal: options.signal,
    });
    if (!details?.dashUrl && !details?.hlsUrl) return null;
    const instanceUrl =
      options.preferredInstanceUrl?.replace(/\/$/, "") ?? "https://inv.nadeko.net";
    const bundle = invidiousStreamsFromVideoDetails(videoId, details, cachePolicy, instanceUrl);
    return bundle.streams.length > 0 ? bundle : null;
  } catch {
    return null;
  }
}
