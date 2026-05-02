import {
  createProviderCachePolicy,
  createResolveTrace,
  createTraceStep,
  type CoreProviderModule,
  vidkingManifest,
} from "@kunai/core";
import type {
  CachePolicy,
  EpisodeIdentity,
  ProviderFailure,
  ProviderFetchPort,
  ProviderResolveInput,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderSourceCandidate,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
  SubtitleCandidate,
  TitleIdentity,
} from "@kunai/types";

export const VIDKING_PROVIDER_ID = vidkingManifest.id;
export const VIDKING_REFERER = "https://www.vidking.net/";
export const VIDKING_ORIGIN = "https://www.vidking.net";
export const VIDKING_API_BASE = "https://api.videasy.net";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const VIDKING_SERVERS = ["mb-flix", "cdn", "downloader2", "1movies"] as const;

type VidkingServer = (typeof VIDKING_SERVERS)[number];

export interface VidkingSourcePayload {
  readonly url?: string;
  readonly quality?: string;
  readonly type?: string;
  readonly language?: string;
}

export interface VidkingSubtitlePayload {
  readonly url?: string;
  readonly src?: string;
  readonly file?: string;
  readonly href?: string;
  readonly lang?: string;
  readonly language?: string;
  readonly label?: string;
  readonly release?: string;
}

export interface VidkingPayload {
  readonly sources?: readonly VidkingSourcePayload[];
  readonly subtitles?: readonly VidkingSubtitlePayload[];
}

type WasmExports = {
  __newString(value: string): number;
  __getString(pointer: number): string;
  decrypt(payloadPointer: number, tmdbId: number): number;
};

let wasmExportsPromise: Promise<WasmExports> | null = null;

export const vidkingProviderModule: CoreProviderModule = {
  providerId: VIDKING_PROVIDER_ID,
  manifest: vidkingManifest,
  async resolve(input, context) {
    const result = await resolveVidkingDirect(input, context);
    if (result) {
      return result;
    }

    return createVidkingExhaustedResult(input, context);
  },
};

export async function resolveVidkingDirect(
  input: ProviderResolveInput,
  context: ProviderRuntimeContext,
): Promise<ProviderResolveResult | null> {
  if (input.mediaKind !== "movie" && input.mediaKind !== "series") {
    return null;
  }

  if (!input.allowedRuntimes.includes("node-fetch")) {
    return createVidkingExhaustedResult(input, context, {
      code: "runtime-missing",
      message: "VidKing direct resolver requires node-fetch runtime",
      retryable: false,
    });
  }

  const tmdbId = resolveTmdbId(input.title);
  if (!tmdbId) {
    return createVidkingExhaustedResult(input, context, {
      code: "unsupported-title",
      message: "VidKing direct resolver requires a numeric TMDB id",
      retryable: false,
    });
  }

  const startedAt = context.now();
  const cachePolicy = createProviderCachePolicy({
    providerId: VIDKING_PROVIDER_ID,
    title: input.title,
    episode: input.episode,
    subtitleLanguage: input.preferredSubtitleLanguage,
    qualityPreference: input.qualityPreference,
  });
  const events: ProviderTraceEvent[] = [];
  const sources: ProviderSourceCandidate[] = [];
  const failures: ProviderFailure[] = [];

  emit(events, context, {
    type: "provider:start",
    providerId: VIDKING_PROVIDER_ID,
    message: "Started VidKing direct Videasy resolution",
  });

  for (const server of VIDKING_SERVERS) {
    const sourceId = createSourceId(server);
    sources.push({
      id: sourceId,
      providerId: VIDKING_PROVIDER_ID,
      kind: "provider-api",
      label: server,
      host: "api.videasy.net",
      status: "probing",
      confidence: 0.8,
      requiresRuntime: "node-fetch",
      cachePolicy,
      metadata: { server },
    });
    emit(events, context, {
      type: "source:start",
      providerId: VIDKING_PROVIDER_ID,
      sourceId,
      message: `Trying Videasy server ${server}`,
    });

    for (const query of buildQueryVariants({
      title: input.title,
      mediaKind: input.mediaKind,
      tmdbId,
      episode: input.episode,
    })) {
      try {
        const response = await fetchVideasyPayload({
          server,
          query,
          fetchPort: context.fetch,
          signal: context.signal,
        });

        if (!response.ok) {
          failures.push({
            providerId: VIDKING_PROVIDER_ID,
            code: response.status === 504 ? "timeout" : "network-error",
            message: `Videasy ${server} returned HTTP ${response.status}`,
            retryable: true,
            at: context.now(),
          });
          continue;
        }

        const payload = (await response.text()).trim();
        if (!payload) {
          continue;
        }

        const decoded = await decodeVidkingPayload(payload, tmdbId);
        const result = createVidkingResultFromPayload({
          input,
          cachePolicy,
          payload: decoded,
          sourceId,
          server,
          events,
          context,
          startedAt,
          failures,
        });

        if (result) {
          return result;
        }
      } catch (error) {
        if (context.signal?.aborted) {
          return createVidkingExhaustedResult(input, context, {
            code: "cancelled",
            message: "VidKing resolution was cancelled",
            retryable: false,
          });
        }

        failures.push({
          providerId: VIDKING_PROVIDER_ID,
          code: "parse-failed",
          message: error instanceof Error ? error.message : "VidKing payload decode failed",
          retryable: true,
          at: context.now(),
        });
      }
    }

    emit(events, context, {
      type: "source:failed",
      providerId: VIDKING_PROVIDER_ID,
      sourceId,
      message: `Videasy server ${server} did not produce a playable source`,
    });
  }

  emit(events, context, {
    type: "provider:exhausted",
    providerId: VIDKING_PROVIDER_ID,
    message: "VidKing direct resolver exhausted all Videasy servers",
  });

  return null;
}

export function createVidkingResultFromPayload({
  input,
  cachePolicy,
  payload,
  sourceId,
  server,
  events = [],
  context,
  startedAt,
  failures = [],
}: {
  readonly input: ProviderResolveInput;
  readonly cachePolicy?: CachePolicy;
  readonly payload: VidkingPayload;
  readonly sourceId?: string;
  readonly server?: string;
  readonly events?: ProviderTraceEvent[];
  readonly context?: ProviderRuntimeContext;
  readonly startedAt?: string;
  readonly failures?: readonly ProviderFailure[];
}): ProviderResolveResult | null {
  const policy =
    cachePolicy ??
    createProviderCachePolicy({
      providerId: VIDKING_PROVIDER_ID,
      title: input.title,
      episode: input.episode,
      subtitleLanguage: input.preferredSubtitleLanguage,
      qualityPreference: input.qualityPreference,
    });
  const resolvedSourceId =
    sourceId ?? createSourceId((server as VidkingServer | undefined) ?? "mb-flix");
  const streams = normalizeStreamCandidates({
    payload,
    input,
    cachePolicy: policy,
    sourceId: resolvedSourceId,
    server,
  });

  if (streams.length === 0) {
    return null;
  }

  const subtitles = normalizeSubtitleCandidates({
    payload,
    input,
    cachePolicy: policy,
    sourceId: resolvedSourceId,
  });
  const selectedStream = selectStreamCandidate(streams, input.qualityPreference);
  const orderedSubtitles = orderSubtitleCandidates(
    subtitles,
    input.preferredSubtitleLanguage ?? "en",
  );
  const variants = createVariantCandidates({
    streams,
    subtitles: orderedSubtitles,
    selectedStreamId: selectedStream.id,
    sourceId: resolvedSourceId,
  });

  emit(events, context, {
    type: "source:success",
    providerId: VIDKING_PROVIDER_ID,
    sourceId: resolvedSourceId,
    message: `Videasy server ${server ?? "unknown"} returned playable candidates`,
    attributes: {
      streams: streams.length,
      subtitles: orderedSubtitles.length,
    },
  });
  emit(events, context, {
    type: "variant:selected",
    providerId: VIDKING_PROVIDER_ID,
    sourceId: resolvedSourceId,
    variantId: selectedStream.variantId,
    streamId: selectedStream.id,
    message: `Selected ${selectedStream.qualityLabel ?? "unknown"} VidKing stream`,
  });

  const selectedSubtitle = orderedSubtitles[0];
  if (selectedSubtitle) {
    emit(events, context, {
      type: "subtitle:selected",
      providerId: VIDKING_PROVIDER_ID,
      sourceId: resolvedSourceId,
      subtitleId: selectedSubtitle.id,
      message: `Selected ${selectedSubtitle.label ?? selectedSubtitle.language ?? "subtitle"} subtitle`,
    });
  }

  emit(events, context, {
    type: "provider:success",
    providerId: VIDKING_PROVIDER_ID,
    sourceId: resolvedSourceId,
    streamId: selectedStream.id,
    message: "VidKing direct resolver produced a stream",
  });

  const endedAt = context?.now() ?? new Date().toISOString();

  return {
    providerId: VIDKING_PROVIDER_ID,
    selectedStreamId: selectedStream.id,
    sources: [
      {
        id: resolvedSourceId,
        providerId: VIDKING_PROVIDER_ID,
        kind: "provider-api",
        label: server ?? "Videasy",
        host: "api.videasy.net",
        status: "selected",
        confidence: 0.9,
        requiresRuntime: "node-fetch",
        cachePolicy: policy,
        metadata: { server },
      },
    ],
    variants,
    streams,
    subtitles: orderedSubtitles,
    cachePolicy: policy,
    trace: createResolveTrace({
      title: input.title,
      episode: input.episode,
      providerId: VIDKING_PROVIDER_ID,
      streamId: selectedStream.id,
      cacheHit: false,
      runtime: "node-fetch",
      startedAt,
      endedAt,
      steps: [
        createTraceStep("provider", "Resolved VidKing through direct Videasy payload", {
          providerId: VIDKING_PROVIDER_ID,
          attributes: {
            source: server ?? null,
            streams: streams.length,
            subtitles: orderedSubtitles.length,
          },
        }),
      ],
      events,
      failures,
    }),
    failures,
    healthDelta: {
      providerId: VIDKING_PROVIDER_ID,
      outcome: "success",
      at: endedAt,
    },
  };
}

async function fetchVideasyPayload({
  server,
  query,
  fetchPort,
  signal,
}: {
  readonly server: VidkingServer;
  readonly query: URLSearchParams;
  readonly fetchPort?: ProviderFetchPort;
  readonly signal?: AbortSignal;
}): Promise<Response> {
  const requester = fetchPort?.fetch.bind(fetchPort) ?? fetch;
  return requester(`${VIDKING_API_BASE}/${server}/sources-with-title?${query.toString()}`, {
    signal: signal ?? AbortSignal.timeout(12_000),
    headers: {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      origin: VIDKING_ORIGIN,
      referer: VIDKING_REFERER,
      "user-agent": USER_AGENT,
    },
  });
}

async function loadWasmExports(): Promise<WasmExports> {
  if (wasmExportsPromise) {
    return wasmExportsPromise;
  }

  wasmExportsPromise = (async () => {
    const loader = await import("@assemblyscript/loader");
    const wasmBuffer = await Bun.file(
      new URL("./assets/module1_patched.wasm", import.meta.url),
    ).arrayBuffer();
    const module = await loader.instantiate(wasmBuffer, {
      env: {
        seed: () => Date.now(),
        abort: () => {},
      },
    });

    return module.exports as unknown as WasmExports;
  })();

  return await wasmExportsPromise;
}

export async function decodeVidkingPayload(
  payload: string,
  tmdbId: number,
): Promise<VidkingPayload> {
  const wasm = await loadWasmExports();
  const payloadPtr = wasm.__newString(payload);
  const decryptedPtr = wasm.decrypt(payloadPtr, tmdbId);
  const wasmDecryptedBase64 = wasm.__getString(decryptedPtr);
  const { default: CryptoJS } = await import("crypto-js");
  const decryptedBytes = CryptoJS.AES.decrypt(wasmDecryptedBase64, "");
  const finalJson = decryptedBytes.toString(CryptoJS.enc.Utf8);
  return JSON.parse(finalJson) as VidkingPayload;
}

function normalizeStreamCandidates({
  payload,
  input,
  cachePolicy,
  sourceId,
  server,
}: {
  readonly payload: VidkingPayload;
  readonly input: ProviderResolveInput;
  readonly cachePolicy: CachePolicy;
  readonly sourceId: string;
  readonly server?: string;
}): StreamCandidate[] {
  const seen = new Set<string>();
  const streams: StreamCandidate[] = [];

  for (const source of payload.sources ?? []) {
    if (!source.url || seen.has(source.url)) {
      continue;
    }
    seen.add(source.url);

    const qualityRank = scoreQuality(source.quality);
    const streamId = `stream:${VIDKING_PROVIDER_ID}:${hashId(source.url)}`;
    const variantId = `variant:${VIDKING_PROVIDER_ID}:${sourceId}:${source.quality ?? "unknown"}`;
    const protocol = inferProtocol(source.url);

    streams.push({
      id: streamId,
      providerId: VIDKING_PROVIDER_ID,
      sourceId,
      variantId,
      url: source.url,
      protocol,
      container:
        protocol === "hls"
          ? "m3u8"
          : protocol === "dash"
            ? "mpd"
            : protocol === "mp4"
              ? "mp4"
              : "unknown",
      audioLanguage: normalizeLanguage(source.language),
      qualityLabel: source.quality,
      qualityRank,
      headers: {
        referer: VIDKING_REFERER,
        origin: VIDKING_ORIGIN,
        "user-agent": USER_AGENT,
      },
      confidence: qualityRank > 0 ? 0.92 : 0.82,
      cachePolicy,
      metadata: {
        server,
        mediaKind: input.mediaKind,
        title: input.title.title,
      },
    });
  }

  return streams.sort((left, right) => (right.qualityRank ?? 0) - (left.qualityRank ?? 0));
}

function normalizeSubtitleCandidates({
  payload,
  input,
  cachePolicy,
  sourceId,
}: {
  readonly payload: VidkingPayload;
  readonly input: ProviderResolveInput;
  readonly cachePolicy: CachePolicy;
  readonly sourceId: string;
}): SubtitleCandidate[] {
  const seen = new Set<string>();
  const subtitles: SubtitleCandidate[] = [];

  for (const subtitle of payload.subtitles ?? []) {
    const url = subtitle.url ?? subtitle.src ?? subtitle.file ?? subtitle.href;
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);

    const language = normalizeLanguage(subtitle.lang ?? subtitle.language ?? subtitle.label);
    subtitles.push({
      id: `subtitle:${VIDKING_PROVIDER_ID}:${hashId(url)}`,
      providerId: VIDKING_PROVIDER_ID,
      sourceId,
      url,
      language,
      label: subtitle.language ?? subtitle.label ?? subtitle.lang?.toUpperCase(),
      format: inferSubtitleFormat(url),
      source: "provider",
      confidence: looksLikeHiSubtitle(subtitle) ? 0.7 : 0.88,
      syncEvidence: subtitle.release,
      cachePolicy: {
        ...cachePolicy,
        ttlClass: "subtitle-list",
        keyParts: [
          ...cachePolicy.keyParts,
          "subtitles",
          input.preferredSubtitleLanguage ?? "default",
        ],
      },
    });
  }

  return subtitles;
}

function createVariantCandidates({
  streams,
  subtitles,
  selectedStreamId,
  sourceId,
}: {
  readonly streams: readonly StreamCandidate[];
  readonly subtitles: readonly SubtitleCandidate[];
  readonly selectedStreamId: string;
  readonly sourceId: string;
}): ProviderVariantCandidate[] {
  return streams.map((stream) => ({
    id: stream.variantId ?? stream.id,
    providerId: VIDKING_PROVIDER_ID,
    sourceId,
    label: stream.qualityLabel ?? stream.container ?? "unknown",
    qualityLabel: stream.qualityLabel,
    qualityRank: stream.qualityRank,
    protocol: stream.protocol,
    container: stream.container,
    audioLanguage: stream.audioLanguage,
    subtitleLanguages: subtitles
      .map((subtitle) => subtitle.language)
      .filter((language): language is string => Boolean(language)),
    streamIds: [stream.id],
    subtitleIds: subtitles.map((subtitle) => subtitle.id),
    selected: stream.id === selectedStreamId,
    confidence: stream.confidence,
  }));
}

function selectStreamCandidate(
  streams: readonly StreamCandidate[],
  qualityPreference: string | undefined,
): StreamCandidate {
  if (qualityPreference) {
    const normalized = qualityPreference.toLowerCase();
    const matched = streams.find((stream) =>
      stream.qualityLabel?.toLowerCase().includes(normalized),
    );
    if (matched) {
      return matched;
    }
  }

  return [...streams].sort((left, right) => (right.qualityRank ?? 0) - (left.qualityRank ?? 0))[0]!;
}

function orderSubtitleCandidates(
  subtitles: readonly SubtitleCandidate[],
  preferredLanguage: string,
): SubtitleCandidate[] {
  if (subtitles.length === 0 || preferredLanguage === "none") {
    return [...subtitles];
  }

  const normalizedPreference = normalizeLanguage(preferredLanguage);
  return [...subtitles].sort((left, right) => {
    const leftLang = left.language ? normalizeLanguage(left.language) : undefined;
    const rightLang = right.language ? normalizeLanguage(right.language) : undefined;
    const langDelta =
      Number(leftLang === normalizedPreference) - Number(rightLang === normalizedPreference);
    if (langDelta !== 0) return -langDelta;

    const hiDelta = Number(looksLikeHiSubtitle(left)) - Number(looksLikeHiSubtitle(right));
    if (hiDelta !== 0) return hiDelta;

    return right.confidence - left.confidence;
  });
}

function buildQueryVariants(opts: {
  readonly title: TitleIdentity;
  readonly mediaKind: "movie" | "series";
  readonly tmdbId: number;
  readonly episode?: EpisodeIdentity;
}): URLSearchParams[] {
  const variants: URLSearchParams[] = [];
  const base = new URLSearchParams({
    title: opts.title.title,
    mediaType: opts.mediaKind === "series" ? "tv" : "movie",
    tmdbId: String(opts.tmdbId),
  });

  if (opts.mediaKind === "series") {
    if (!opts.episode?.season || !opts.episode.episode) {
      return [];
    }
    base.set("seasonId", String(opts.episode.season));
    base.set("episodeId", String(opts.episode.episode));
  }

  if (opts.title.year) {
    const withYear = new URLSearchParams(base);
    withYear.set("year", String(opts.title.year));
    variants.push(withYear);
  }

  variants.push(base);
  return variants;
}

function createVidkingExhaustedResult(
  input: ProviderResolveInput,
  context: ProviderRuntimeContext,
  failure: Omit<ProviderFailure, "providerId" | "at"> = {
    code: "not-found",
    message: "VidKing direct resolver did not find a playable source",
    retryable: true,
  },
): ProviderResolveResult {
  const at = context.now();
  const providerFailure: ProviderFailure = {
    providerId: VIDKING_PROVIDER_ID,
    at,
    ...failure,
  };

  const event: ProviderTraceEvent = {
    type: "provider:exhausted",
    at,
    providerId: VIDKING_PROVIDER_ID,
    message: providerFailure.message,
  };
  context.emit?.(event);

  return {
    providerId: VIDKING_PROVIDER_ID,
    streams: [],
    subtitles: [],
    cachePolicy: createProviderCachePolicy({
      providerId: VIDKING_PROVIDER_ID,
      title: input.title,
      episode: input.episode,
      subtitleLanguage: input.preferredSubtitleLanguage,
      qualityPreference: input.qualityPreference,
    }),
    trace: createResolveTrace({
      title: input.title,
      episode: input.episode,
      providerId: VIDKING_PROVIDER_ID,
      cacheHit: false,
      runtime: "node-fetch",
      startedAt: at,
      endedAt: at,
      steps: [
        createTraceStep("provider", providerFailure.message, {
          providerId: VIDKING_PROVIDER_ID,
          attributes: { code: providerFailure.code },
        }),
      ],
      events: [event],
      failures: [providerFailure],
    }),
    failures: [providerFailure],
    healthDelta: {
      providerId: VIDKING_PROVIDER_ID,
      outcome: providerFailure.code === "cancelled" ? "failure" : "failure",
      at,
    },
  };
}

function emit(
  events: ProviderTraceEvent[],
  context: ProviderRuntimeContext | undefined,
  event: Omit<ProviderTraceEvent, "at">,
): void {
  const fullEvent = {
    ...event,
    at: context?.now() ?? new Date().toISOString(),
  };
  events.push(fullEvent);
  context?.emit?.(fullEvent);
}

function resolveTmdbId(title: TitleIdentity): number | null {
  const raw = title.tmdbId ?? title.id;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function createSourceId(server: VidkingServer | string): string {
  return `source:${VIDKING_PROVIDER_ID}:videasy:${server}`;
}

function scoreQuality(quality: string | undefined): number {
  const numeric = Number.parseInt(quality ?? "", 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function inferProtocol(url: string): StreamCandidate["protocol"] {
  const lower = url.toLowerCase();
  if (lower.includes(".m3u8")) return "hls";
  if (lower.includes(".mpd")) return "dash";
  if (lower.includes(".mp4")) return "mp4";
  return "unknown";
}

function inferSubtitleFormat(url: string): SubtitleCandidate["format"] {
  const lower = url.toLowerCase();
  if (lower.endsWith(".srt")) return "srt";
  if (lower.endsWith(".vtt")) return "vtt";
  if (lower.endsWith(".ass")) return "ass";
  return "unknown";
}

function normalizeLanguage(value: string | undefined): string | undefined {
  const raw = value?.trim().toLowerCase();
  if (!raw) {
    return undefined;
  }

  const normalized = raw
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const map: Record<string, string> = {
    eng: "en",
    english: "en",
    ara: "ar",
    arabic: "ar",
    spa: "es",
    spanish: "es",
    fre: "fr",
    fra: "fr",
    french: "fr",
    ger: "de",
    deu: "de",
    german: "de",
    jpn: "ja",
    japanese: "ja",
  };

  if (map[normalized]) {
    return map[normalized];
  }

  for (const [prefix, language] of Object.entries(map)) {
    if (normalized.startsWith(prefix)) {
      return language;
    }
  }

  return normalized;
}

function looksLikeHiSubtitle(
  subtitle: Pick<SubtitleCandidate, "label" | "syncEvidence"> | VidkingSubtitlePayload,
): boolean {
  const release =
    "syncEvidence" in subtitle
      ? subtitle.syncEvidence
      : (subtitle as VidkingSubtitlePayload).release;
  const raw = [subtitle.label, release, "language" in subtitle ? subtitle.language : undefined]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  return raw.includes("sdh") || /\bhi\b/.test(raw) || raw.includes("hearing");
}

function hashId(value: string): string {
  return Bun.hash(value).toString(36);
}
