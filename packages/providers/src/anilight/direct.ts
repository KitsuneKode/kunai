import type { CoreProviderModule } from "@kunai/core";
import type {
  ProviderEpisodeListInput,
  ProviderEpisodeOption,
  ProviderResolveInput,
  ProviderRuntimeContext,
  ProviderSearchInput,
  ProviderSearchResult,
} from "@kunai/types";
import { ProviderHttpError } from "@kunai/types";
import { z } from "zod";

import { resolveAnimeAudioIntent } from "../shared/anime-audio-intent";
import { formatAnimeEpisodeLabel } from "../shared/anime-metadata";
import {
  resolveMultiSourceProvider,
  type MultiSourceResolvePayload,
  type MultiSourceStreamInput,
  type MultiSourceSubtitleInput,
} from "../shared/multi-source-resolver";
import {
  episodeNumberFromProviderIdentity,
  selectProviderEpisodeNumber,
} from "../shared/provider-episode-number";
import { createProviderJsonFetch } from "../shared/provider-json-fetch";
import { matchProviderCatalogTitle } from "../shared/provider-title-match";
import { normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import { CHROME_137_USER_AGENT } from "../shared/user-agent";
import { ANILIGHT_PROVIDER_ID, anilightManifest } from "./manifest";

export { ANILIGHT_PROVIDER_ID };

const API_BASE = "https://api.anilight.live/api";
const SITE_ORIGIN = "https://anilight.live";
const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT = CHROME_137_USER_AGENT;

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

const aniLightEpisodeSchema = z.object({
  number: z.number().optional(),
  epNum: z.number().optional(),
  title: z.string().optional(),
  img: z.string().optional(),
  airedAt: z.string().optional(),
  sub: z.boolean().optional(),
  dub: z.boolean().optional(),
  subReleased: z.boolean().optional(),
  dubReleased: z.boolean().optional(),
});

const aniLightEpisodeEntrySchema = z.union([
  z.number().transform((number): z.infer<typeof aniLightEpisodeSchema> => ({
    number,
    sub: true,
    dub: false,
  })),
  aniLightEpisodeSchema,
]);

const aniLightWatchPayloadSchema = z.object({
  id: z.number().optional(),
  episodes: z.array(aniLightEpisodeEntrySchema).optional(),
  subEpisodes: z.number().optional(),
  dubEpisodes: z.number().optional(),
});

type AniLightWatchPayload = z.infer<typeof aniLightWatchPayloadSchema>;

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

const fetchJson = createProviderJsonFetch({
  providerId: ANILIGHT_PROVIDER_ID,
  label: "AniLight",
  origin: SITE_ORIGIN,
  userAgent: USER_AGENT,
  timeoutMs: FETCH_TIMEOUT_MS,
});

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
  const body = await fetchJson<unknown>(
    context,
    `${API_BASE}/watch/${encodeURIComponent(slug)}`,
    "episode catalog",
  );
  const parsed = aniLightWatchPayloadSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
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
  const raw = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const entry of raw) {
    if (!entry?.trim()) continue;
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
    episodeNumberFromProviderIdentity(input.episode, ANILIGHT_PROVIDER_ID) ??
    selectProviderEpisodeNumber(input.episode);
  const entry = entries.find(
    (candidate) => (candidate.number ?? candidate.epNum) === requestedEpisode,
  );
  if (!entry) return null;
  const details = entry;
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
      const number = entry.number ?? entry.epNum;
      if (!number) return [];
      const details = entry;
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
