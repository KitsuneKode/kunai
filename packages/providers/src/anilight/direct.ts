import type { CoreProviderModule } from "@kunai/core";
import type {
  ProviderEpisodeListInput,
  ProviderEpisodeOption,
  ProviderResolveInput,
  ProviderRuntimeContext,
  ProviderSearchInput,
  ProviderSearchResult,
} from "@kunai/types";
import {
  httpStatusIsRetryable,
  httpStatusToResolveErrorCode,
  ProviderHttpError,
} from "@kunai/types";

import { providerFetch } from "../runtime/fetch";
import { resolveAnimeAudioIntent } from "../shared/anime-audio-intent";
import { formatAnimeEpisodeLabel } from "../shared/anime-metadata";
import { directStreamFetchSignal } from "../shared/direct-stream-source";
import { readJsonObjectBody } from "../shared/json-body";
import {
  resolveMultiSourceProvider,
  type MultiSourceResolvePayload,
  type MultiSourceStreamInput,
  type MultiSourceSubtitleInput,
} from "../shared/multi-source-resolver";
import { selectProviderEpisodeNumber } from "../shared/provider-episode-number";
import { matchProviderCatalogTitle } from "../shared/provider-title-match";
import { normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import { ANILIGHT_PROVIDER_ID, anilightManifest } from "./manifest";

export { ANILIGHT_PROVIDER_ID };

const API_BASE = "https://api.anilight.live/api";
const SITE_ORIGIN = "https://anilight.live";
const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

type AniLightTitle = {
  readonly romaji?: string;
  readonly english?: string;
  readonly native?: string;
};

interface AniLightAnimeRow {
  readonly id?: number;
  readonly slug?: string;
  readonly anilistId?: number;
  readonly idMal?: number;
  readonly title?: AniLightTitle;
  readonly episodes?: number;
  readonly subEpisodes?: number;
  readonly dubEpisodes?: number;
  readonly seasonYear?: number;
  readonly description?: string;
  readonly coverImage?: { readonly large?: string; readonly extraLarge?: string };
  readonly bannerImage?: string;
  readonly status?: string;
}

interface AniLightEpisode {
  readonly number?: number;
  readonly epNum?: number;
  readonly title?: string;
  readonly img?: string;
  readonly airedAt?: string;
  readonly sub?: boolean;
  readonly dub?: boolean;
  readonly subReleased?: boolean;
  readonly dubReleased?: boolean;
}

interface AniLightWatchPayload {
  readonly id?: number;
  readonly episodes?: readonly (AniLightEpisode | number)[];
  readonly subEpisodes?: number;
  readonly dubEpisodes?: number;
}

interface AniLightTrack {
  readonly id?: string;
  readonly url?: string;
  readonly file?: string;
  readonly kind?: string;
  readonly lang?: string;
  readonly label?: string;
  readonly default?: boolean;
}

interface AniLightSource {
  readonly url?: string | readonly string[];
  readonly type?: string;
  readonly quality?: string;
}

interface AniLightSourcesPayload {
  readonly audio?: unknown;
  readonly tracks?: readonly AniLightTrack[];
  readonly sources?: readonly AniLightSource[];
  readonly provider?: string;
  readonly streamProxies?: readonly string[];
}

interface AniLightResolvedShow {
  readonly slug: string;
  readonly row?: AniLightAnimeRow;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Accept: "application/json",
    Origin: SITE_ORIGIN,
    Referer: `${SITE_ORIGIN}/`,
    "User-Agent": USER_AGENT,
    ...extra,
  };
}

async function fetchJson<T>(
  context: ProviderRuntimeContext,
  url: string,
  stage: string,
  init?: RequestInit,
): Promise<T | null> {
  const response = await providerFetch(context, url, {
    ...init,
    headers: { ...headers(), ...(init?.headers as Record<string, string> | undefined) },
    signal: directStreamFetchSignal(context.signal, FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderHttpError({
      providerId: ANILIGHT_PROVIDER_ID,
      stage,
      status,
      message: `AniLight ${stage} returned HTTP ${status}`,
      code: status === 404 || status === 410 ? "not-found" : httpStatusToResolveErrorCode(status),
      retryable: httpStatusIsRetryable(status),
    });
  }
  if ((init?.method ?? "GET").toUpperCase() === "POST") {
    return (await response.json()) as T;
  }
  return readJsonObjectBody<T>(response);
}

async function checkExists(
  anilistId: string,
  context: ProviderRuntimeContext,
): Promise<string | null> {
  const data = await fetchJson<{ exists?: boolean; slug?: string }>(
    context,
    `${API_BASE}/anime/check-exists?anilistId=${encodeURIComponent(anilistId)}`,
    "anilist lookup",
  );
  return data?.exists && data.slug ? data.slug : null;
}

async function searchRows(query: string, context: ProviderRuntimeContext) {
  const rows = await fetchJson<readonly AniLightAnimeRow[]>(
    context,
    `${API_BASE}/search?q=${encodeURIComponent(query)}&hideAdult=true`,
    "search",
  );
  return Array.isArray(rows) ? rows : [];
}

function providerNativeId(
  title: ProviderResolveInput["title"] | ProviderEpisodeListInput["title"],
) {
  const native = title.externalIds?.providerNativeIds?.[ANILIGHT_PROVIDER_ID];
  if (native) return native;
  if (title.id.startsWith(`${ANILIGHT_PROVIDER_ID}:`)) {
    return title.id.slice(ANILIGHT_PROVIDER_ID.length + 1);
  }
  return undefined;
}

async function resolveShow(
  title: ProviderResolveInput["title"] | ProviderEpisodeListInput["title"],
  context: ProviderRuntimeContext,
): Promise<AniLightResolvedShow | null> {
  const native = providerNativeId(title);
  if (native) return { slug: native };
  const anilistId = title.externalIds?.anilistId ?? title.anilistId;
  if (anilistId) {
    const bridged = context.titleBridge?.get({
      providerId: ANILIGHT_PROVIDER_ID,
      catalogKind: "anime",
      catalogId: `anilist:${anilistId}`,
    });
    if (bridged) return { slug: bridged };
    const slug = await checkExists(anilistId, context).catch(() => null);
    if (slug) {
      context.titleBridge?.set({
        providerId: ANILIGHT_PROVIDER_ID,
        catalogKind: "anime",
        catalogId: `anilist:${anilistId}`,
        nativeId: slug,
      });
      return { slug };
    }
  }

  const rows = await searchRows(title.title, context);
  const match = matchProviderCatalogTitle(
    rows.map((row) => ({
      slug: row.slug ?? "",
      title: row.title?.romaji ?? row.title?.english ?? "",
      englishTitle: row.title?.english,
      altNames: [row.title?.native].filter((name): name is string => Boolean(name)),
      year: row.seasonYear,
    })),
    { title: title.title, year: title.year, altNames: title.aliases },
  );
  return match?.slug ? { slug: match.slug } : null;
}

async function fetchWatch(
  slug: string,
  context: ProviderRuntimeContext,
): Promise<AniLightWatchPayload | null> {
  return fetchJson<AniLightWatchPayload>(
    context,
    `${API_BASE}/watch/${encodeURIComponent(slug)}`,
    "episode catalog",
  );
}

function episodeNumber(entry: AniLightEpisode | number): number | undefined {
  return typeof entry === "number" ? entry : (entry.number ?? entry.epNum);
}

function episodeObject(entry: AniLightEpisode | number): AniLightEpisode {
  return typeof entry === "number" ? { number: entry, sub: true, dub: false } : entry;
}

async function createSourceSession(context: ProviderRuntimeContext): Promise<string> {
  const data = await fetchJson<{ sessionToken?: string }>(
    context,
    `${API_BASE}/sources/session`,
    "source session",
    { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } },
  );
  if (!data?.sessionToken) {
    throw new ProviderHttpError({
      providerId: ANILIGHT_PROVIDER_ID,
      stage: "source session",
      message: "AniLight source session response carried no sessionToken",
      code: "parse-failed",
      retryable: false,
    });
  }
  return data.sessionToken;
}

async function fetchSources(
  context: ProviderRuntimeContext,
  input: {
    readonly slug: string;
    readonly episode: number;
    readonly language: "sub" | "dub";
    readonly backup: boolean;
    readonly sessionToken: string;
  },
): Promise<AniLightSourcesPayload | null> {
  const params = new URLSearchParams({
    slug: input.slug,
    episode: String(input.episode),
    language: input.language,
  });
  if (input.backup) params.set("backup", "true");
  return fetchJson<AniLightSourcesPayload>(
    context,
    `${API_BASE}/sources?${params.toString()}`,
    input.backup ? "backup sources" : "sources",
    { headers: { "x-source-session": input.sessionToken } },
  );
}

function mediaUrls(
  value: string | readonly string[] | undefined,
  proxies: readonly string[] | undefined,
) {
  const raw = (Array.isArray(value) ? value : [value]).filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
  const out: string[] = [];
  for (const entry of raw) {
    if (/^https?:\/\//i.test(entry)) {
      out.push(entry);
      continue;
    }
    for (const proxy of proxies ?? []) {
      if (!/^https:\/\//i.test(proxy)) continue;
      out.push(`${proxy.replace(/\/+$/, "")}/e/${entry}`);
    }
  }
  return [...new Set(out)];
}

function captionUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_BASE}/proxy/captions?token=${encodeURIComponent(value)}`;
}

function collectSources(
  payload: AniLightSourcesPayload | null,
  input: {
    readonly mode: "sub" | "dub";
    readonly backup: boolean;
    readonly episode: number;
  },
  streams: MultiSourceStreamInput[],
  subtitles: MultiSourceSubtitleInput[],
): string | null {
  const upstream = payload?.provider?.trim() || (input.backup ? "backup" : "primary");
  const sourceKey = `${input.mode}-${upstream}${input.backup ? "-backup" : ""}`;
  const sourceLabel = `${input.mode === "dub" ? "Dub" : "Sub"} ${upstream}${input.backup ? " backup" : ""}`;
  const subtitleLanguages = [
    ...new Set(
      (payload?.tracks ?? [])
        .filter((track) => track.kind !== "thumbnails")
        .map((track) => normalizeIsoLanguageCode(track.lang ?? track.label) ?? track.lang)
        .filter((language): language is string => Boolean(language)),
    ),
  ];
  for (const track of payload?.tracks ?? []) {
    if (track.kind === "thumbnails") continue;
    const url = captionUrl(track.file ?? track.url);
    if (!url) continue;
    subtitles.push({
      sourceKey,
      url,
      language: normalizeIsoLanguageCode(track.lang ?? track.label) ?? track.lang,
      label: track.label ?? track.lang,
      type: "vtt",
    });
  }
  for (const source of payload?.sources ?? []) {
    for (const url of mediaUrls(source.url, payload?.streamProxies)) {
      streams.push({
        sourceKey,
        sourceLabel,
        url,
        qualityHint: source.quality,
        protocol: source.type === "hls" ? "hls" : source.type === "mp4" ? "mp4" : undefined,
        audioLanguages: [input.mode === "dub" ? "en" : "ja"],
        presentation: input.mode,
        subtitleDelivery: subtitleLanguages.length > 0 ? "external" : undefined,
        subtitleLanguages,
        metadata: {
          audioMode: input.mode,
          upstreamProvider: upstream,
          backup: input.backup,
          episode: input.episode,
        },
      });
    }
  }
  return sourceKey;
}

async function fetchAnilightPayload(
  input: ProviderResolveInput,
  context: ProviderRuntimeContext,
): Promise<MultiSourceResolvePayload | null> {
  const show = await resolveShow(input.title, context);
  if (!show) return null;
  const watch = await fetchWatch(show.slug, context);
  const entries = watch?.episodes ?? [];
  if (entries.length === 0) return null;
  const requestedEpisode =
    episodeNumberFromIdentity(input) ?? selectProviderEpisodeNumber(input.episode);
  const entry = entries.find((candidate) => episodeNumber(candidate) === requestedEpisode);
  if (!entry) return null;
  const details = episodeObject(entry);
  const preferredSourceMode = input.preferredSourceId?.includes(":dub")
    ? "dub"
    : input.preferredSourceId?.includes(":sub")
      ? "sub"
      : undefined;
  const mode =
    preferredSourceMode ??
    resolveAnimeAudioIntent(
      input.preferredAudioLanguage ?? input.preferredPresentation ?? "original",
    ).catalogMode;
  const available =
    mode === "dub" ? (details.dub ?? details.dubReleased) : (details.sub ?? details.subReleased);
  if (!available) {
    throw new ProviderHttpError({
      providerId: ANILIGHT_PROVIDER_ID,
      stage: "sources",
      message: `AniLight episode ${requestedEpisode} has no ${mode} audio`,
      code: "not-found",
      retryable: false,
    });
  }

  const sessionToken = await createSourceSession(context);
  const streams: MultiSourceStreamInput[] = [];
  const subtitles: MultiSourceSubtitleInput[] = [];
  const primary = await fetchSources(context, {
    slug: show.slug,
    episode: requestedEpisode,
    language: mode,
    backup: false,
    sessionToken,
  });
  collectSources(primary, { mode, backup: false, episode: requestedEpisode }, streams, subtitles);
  try {
    const backup = await fetchSources(context, {
      slug: show.slug,
      episode: requestedEpisode,
      language: mode,
      backup: true,
      sessionToken,
    });
    collectSources(backup, { mode, backup: true, episode: requestedEpisode }, streams, subtitles);
  } catch (error) {
    if (error instanceof ProviderHttpError && error.code === "not-found") {
      // Backup absence is normal catalog shape, not a failure of the primary row.
    } else if (!(error instanceof ProviderHttpError)) {
      throw error;
    }
  }

  return {
    streams,
    subtitles,
    externalIds: {
      anilistId: input.title.externalIds?.anilistId ?? input.title.anilistId,
      malId: input.title.externalIds?.malId ?? input.title.malId,
      providerNativeIds: { [ANILIGHT_PROVIDER_ID]: show.slug },
    },
  };
}

function episodeNumberFromIdentity(input: ProviderResolveInput): number | undefined {
  const identity = input.episode?.providerEpisodeIdentity;
  if (identity?.providerId !== ANILIGHT_PROVIDER_ID) return undefined;
  const match = /^ep:(\d+)$/.exec(identity.value);
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

export const anilightProviderModule: CoreProviderModule = {
  providerId: ANILIGHT_PROVIDER_ID,
  manifest: anilightManifest,

  async search(
    input: ProviderSearchInput,
    context,
  ): Promise<readonly ProviderSearchResult[] | null> {
    let rows: readonly AniLightAnimeRow[];
    try {
      rows = await searchRows(input.query, context);
    } catch {
      return null;
    }
    return rows.slice(0, 40).map((row) => {
      const title =
        row.title?.english ?? row.title?.romaji ?? row.title?.native ?? row.slug ?? "Untitled";
      const modes = [
        (row.subEpisodes ?? 0) > 0 ? ("sub" as const) : null,
        (row.dubEpisodes ?? 0) > 0 ? ("dub" as const) : null,
      ].filter((mode): mode is "sub" | "dub" => Boolean(mode));
      return {
        id: row.slug ?? String(row.id ?? ""),
        type: "series" as const,
        title,
        year: row.seasonYear ? String(row.seasonYear) : undefined,
        overview: row.description,
        posterPath: row.coverImage?.extraLarge ?? row.coverImage?.large ?? null,
        metadataSource: "AniLight",
        episodeCount: row.episodes,
        availableAudioModes: modes,
        subtitleAvailability: "softsub" as const,
        englishTitle: row.title?.english,
        nativeTitle: row.title?.native,
        altNames: [row.title?.romaji, row.title?.native].filter((name): name is string =>
          Boolean(name),
        ),
        externalIds: {
          anilistId: row.anilistId ? String(row.anilistId) : undefined,
          malId: row.idMal ? String(row.idMal) : undefined,
          providerNativeIds: row.slug ? { [ANILIGHT_PROVIDER_ID]: row.slug } : undefined,
        },
        artwork: {
          posterUrl: row.coverImage?.extraLarge ?? row.coverImage?.large,
          backdropUrl: row.bannerImage,
        },
      };
    });
  },

  async listEpisodes(
    input: ProviderEpisodeListInput,
    context,
  ): Promise<readonly ProviderEpisodeOption[] | null> {
    let show: AniLightResolvedShow | null;
    let watch: AniLightWatchPayload | null;
    try {
      show = await resolveShow(input.title, context);
      if (!show) return null;
      watch = await fetchWatch(show.slug, context);
    } catch {
      return null;
    }
    const entries = watch?.episodes ?? [];
    return entries.flatMap((entry) => {
      const number = episodeNumber(entry);
      if (!number) return [];
      const details = episodeObject(entry);
      return [
        {
          index: number,
          label: formatAnimeEpisodeLabel(number, details.title),
          ...(details.title ? { name: details.title } : null),
          detail: `Episode ${number}`,
          totalEpisodeCount: entries.length,
          providerEpisodeIdentity: { providerId: ANILIGHT_PROVIDER_ID, value: `ep:${number}` },
          release: details.airedAt
            ? { airDate: details.airedAt, status: "released" as const }
            : undefined,
          artwork: details.img ? { thumbnailUrl: details.img } : undefined,
        },
      ];
    });
  },

  async resolve(input, context) {
    return resolveMultiSourceProvider({
      providerId: ANILIGHT_PROVIDER_ID,
      label: "AniLight",
      input,
      context,
      supportedMediaKinds: ["anime"],
      unsupportedMessage: "AniLight only supports anime",
      traceMessage: "Resolved AniLight proxied direct stream",
      fetchPayload: () => fetchAnilightPayload(input, context),
    });
  },
};
