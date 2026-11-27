import type { CoreProviderModule } from "@kunai/core";
import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";
import {
  httpStatusIsRetryable,
  httpStatusToResolveErrorCode,
  ProviderHttpError,
} from "@kunai/types";

import { providerFetch } from "../runtime/fetch";
import { directStreamFetchSignal } from "../shared/direct-stream-source";
import {
  masterVariantsNeedSeparateAudio,
  parseHlsMasterMaxHeight,
  parseHlsMasterRenditions,
  parseHlsMasterVariants,
} from "../shared/hls-ladder";
import { readJsonObjectBody } from "../shared/json-body";
import {
  resolveMultiSourceProvider,
  type MultiSourceResolvePayload,
  type MultiSourceStreamInput,
  type MultiSourceSubtitleInput,
} from "../shared/multi-source-resolver";
import { normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import { VIDBOLT_PROVIDER_ID, vidboltManifest } from "./manifest";

export { VIDBOLT_PROVIDER_ID };

const VIDBOLT_API_BASE = "https://vidbolt.pro/api";
const VIDBOLT_ORIGIN = "https://vidbolt.pro";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_SERVER_STEPS = 8;

interface VidboltSourceEntry {
  readonly url?: string;
  readonly kind?: string;
  readonly quality?: string;
  readonly language?: string;
  readonly master?: string;
}

interface VidboltSubtitleEntry {
  readonly url?: string;
  readonly label?: string;
  readonly lang?: string;
}

interface VidboltResolveResponse {
  readonly stream?: {
    readonly server?: string;
    readonly sources?: readonly VidboltSourceEntry[];
    readonly subtitles?: readonly VidboltSubtitleEntry[];
    readonly thumbnails?: string;
  } | null;
}

export const vidboltProviderModule: CoreProviderModule = {
  providerId: VIDBOLT_PROVIDER_ID,
  manifest: vidboltManifest,
  resolve: resolveVidboltDirect,
};

export function resolveVidboltDirect(input: ProviderResolveInput, context: ProviderRuntimeContext) {
  return resolveMultiSourceProvider({
    providerId: VIDBOLT_PROVIDER_ID,
    label: "VidBolt",
    input,
    context,
    supportedMediaKinds: ["movie", "series"],
    unsupportedMessage: "VidBolt only supports movie and series content",
    traceMessage: "Resolved VidBolt multi-server direct stream",
    fetchPayload: () => fetchVidboltPayload(input, context),
  });
}

function vidboltApiUrl(input: ProviderResolveInput, excluded: readonly string[]): string {
  const tmdbId = input.title.tmdbId ?? input.title.externalIds?.tmdbId;
  const params = new URLSearchParams();
  if (input.mediaKind === "movie") {
    params.set("type", "movie");
    params.set("id", String(tmdbId));
  } else {
    params.set("type", "tv");
    params.set("id", String(tmdbId));
    params.set("season", String(input.episode?.season ?? 1));
    params.set("episode", String(input.episode?.episode ?? 1));
  }
  if (excluded.length > 0) params.set("exclude", excluded.join(","));
  return `${VIDBOLT_API_BASE}/resolve?${params.toString()}`;
}

function streamHeaders(): Record<string, string> {
  return {
    Accept: "*/*",
    Origin: VIDBOLT_ORIGIN,
    Referer: `${VIDBOLT_ORIGIN}/`,
    "User-Agent": USER_AGENT,
  };
}

async function fetchVidboltPayload(
  input: ProviderResolveInput,
  context: ProviderRuntimeContext,
): Promise<MultiSourceResolvePayload | null> {
  const streams: MultiSourceStreamInput[] = [];
  const subtitles: MultiSourceSubtitleInput[] = [];
  const emptySources: {
    readonly sourceKey: string;
    readonly label?: string;
    readonly host?: string;
    readonly metadata?: Record<string, unknown>;
  }[] = [];
  const excluded: string[] = [];
  const headers = streamHeaders();

  for (let step = 0; step < MAX_SERVER_STEPS; step += 1) {
    if (context.signal?.aborted) break;
    const response = await providerFetch(context, vidboltApiUrl(input, excluded), {
      headers: {
        Accept: "application/json",
        Origin: VIDBOLT_ORIGIN,
        Referer: refererFor(input),
        "User-Agent": USER_AGENT,
      },
      signal: directStreamFetchSignal(context.signal, FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderHttpError({
        providerId: VIDBOLT_PROVIDER_ID,
        stage: "api",
        status,
        message: `VidBolt API returned HTTP ${status}`,
        code: status === 404 || status === 410 ? "not-found" : httpStatusToResolveErrorCode(status),
        retryable: httpStatusIsRetryable(status),
      });
    }
    const body = await readJsonObjectBody<VidboltResolveResponse>(response);
    const stream = body?.stream;
    const server = stream?.server?.trim();
    if (!stream || !server) break;
    if (excluded.includes(server)) break;
    excluded.push(server);

    const before = streams.length;
    for (const source of stream.sources ?? []) {
      collectVidboltSource(server, source, headers, streams, subtitles);
    }
    for (const subtitle of stream.subtitles ?? []) {
      if (!subtitle.url) continue;
      subtitles.push({
        sourceKey: server,
        url: subtitle.url,
        language: normalizeIsoLanguageCode(subtitle.lang ?? subtitle.label) ?? subtitle.lang,
        label: subtitle.label ?? subtitle.lang,
        type: subtitle.url,
      });
    }
    if (streams.length === before) {
      emptySources.push({
        sourceKey: server,
        label: server,
        host: hostOf(stream.sources?.[0]?.url),
      });
    }
  }

  return streams.length > 0 || emptySources.length > 0
    ? { streams, subtitles, emptySources }
    : null;
}

function refererFor(input: ProviderResolveInput): string {
  const tmdbId = input.title.tmdbId ?? input.title.externalIds?.tmdbId;
  if (input.mediaKind === "movie") return `${VIDBOLT_ORIGIN}/embed/movie/${tmdbId}`;
  return `${VIDBOLT_ORIGIN}/embed/tv/${tmdbId}/${input.episode?.season ?? 1}/${input.episode?.episode ?? 1}`;
}

function collectVidboltSource(
  server: string,
  source: VidboltSourceEntry,
  headers: Record<string, string>,
  streams: MultiSourceStreamInput[],
  subtitles: MultiSourceSubtitleInput[],
): void {
  if (!source.url) return;
  const declaredLanguage = normalizeIsoLanguageCode(source.language) ?? undefined;
  const master = source.master?.trim();
  const renditions = master ? parseHlsMasterRenditions(master, source.url) : undefined;
  const audioLanguages = [
    ...new Set([
      ...(declaredLanguage ? [declaredLanguage] : []),
      ...(renditions?.audioLanguages ?? []),
    ]),
  ];
  if (master) {
    for (const track of renditions?.subtitleTracks ?? []) {
      subtitles.push({
        sourceKey: server,
        url: track.url,
        language: track.language,
        label: track.label,
        type: "vtt",
      });
    }
  }

  const push = (
    url: string,
    qualityHint?: string,
    protocol?: MultiSourceStreamInput["protocol"],
  ) => {
    streams.push({
      sourceKey: server,
      sourceLabel: server,
      url,
      qualityHint: qualityHint ?? source.quality,
      protocol: protocol ?? (source.kind === "hls" ? "hls" : undefined),
      audioLanguages: audioLanguages.length > 0 ? audioLanguages : undefined,
      headers,
      subtitleDelivery: "external",
      metadata: { server },
    });
  };

  if (master && source.kind === "hls") {
    if (masterVariantsNeedSeparateAudio(master)) {
      // These variants are video-only: shipping one loses the audio rendition.
      // The master stays the playable row, ranked by the declared ceiling.
      const maxHeight = parseHlsMasterMaxHeight(master);
      push(source.url, maxHeight ? `${maxHeight}p` : source.quality, "hls");
      return;
    }
    const variants = parseHlsMasterVariants(master, source.url);
    if (variants.length > 0) {
      for (const variant of variants) push(variant.url, variant.qualityLabel, "hls");
      return;
    }
  }
  push(source.url, source.quality);
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
