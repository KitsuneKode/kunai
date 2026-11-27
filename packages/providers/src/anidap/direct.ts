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
import { z } from "zod";

import { providerFetch } from "../runtime/fetch";
import { resolveAnimeAudioIntent } from "../shared/anime-audio-intent";
import { formatAnimeEpisodeLabel } from "../shared/anime-metadata";
import { directStreamFetchSignal } from "../shared/direct-stream-source";
import { readJsonObjectBody } from "../shared/json-body";
import {
  resolveMultiSourceProvider,
  type MultiSourceEmptySourceInput,
  type MultiSourceResolvePayload,
  type MultiSourceStreamInput,
  type MultiSourceSubtitleInput,
} from "../shared/multi-source-resolver";
import { selectProviderEpisodeNumber } from "../shared/provider-episode-number";
import { matchProviderCatalogTitle } from "../shared/provider-title-match";
import { normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import { ANIDAP_PROVIDER_ID, anidapManifest } from "./manifest";

export { ANIDAP_PROVIDER_ID };

const GRAPHQL_URL = "https://graphql.anidap.lol/graphql";
const REST_BASE = "https://chad.anidap.lol/rest/api";
const SITE_ORIGIN = "https://anidap.lol";
const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

const optionalString = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);
const optionalNumber = z
  .number()
  .nullish()
  .transform((value) => value ?? undefined);

const anidapCoverImageObjectSchema = z.object({
  large: z.string().optional(),
  extraLarge: z.string().optional(),
});

const anidapCoverImageSchema = z
  .union([z.string().transform((large) => ({ large })), anidapCoverImageObjectSchema])
  .nullish()
  .transform((value) => (value ? anidapCoverImageObjectSchema.parse(value) : undefined));

const anidapAnimeNodeSchema = z.object({
  id: optionalString,
  anilistId: optionalNumber,
  malId: optionalNumber,
  titleRomaji: optionalString,
  titleEnglish: optionalString,
  titles: z
    .record(z.string(), z.string())
    .nullish()
    .transform((value) => value ?? undefined),
  episodeCount: optionalNumber,
  seasonYear: optionalNumber,
  format: optionalString,
  coverImage: anidapCoverImageSchema,
  bannerImage: optionalString,
  description: optionalString,
  popularity: optionalNumber,
  averageScore: optionalNumber,
});

type AnidapAnimeNode = z.infer<typeof anidapAnimeNodeSchema>;

interface AnidapEpisode {
  readonly number?: number;
  readonly titles?: Record<string, string>;
  readonly img?: string;
  readonly description?: string;
  readonly airDateUtc?: string;
  readonly hasDub?: boolean;
  readonly hasSub?: boolean;
}

const anidapServerEntrySchema = z.union([
  z.string().transform((id) => ({ id, tip: undefined, default: undefined })),
  z.object({
    id: z.string().optional(),
    default: z.boolean().optional(),
    tip: z.string().optional(),
  }),
]);

const anidapServersPayloadSchema = z.object({
  subProviders: z.array(anidapServerEntrySchema).optional(),
  dubProviders: z.array(anidapServerEntrySchema).optional(),
});

type AnidapServersPayload = z.infer<typeof anidapServersPayloadSchema>;

interface AnidapSourceEntry {
  readonly url?: string;
  readonly quality?: string;
  readonly type?: string;
}

interface AnidapTrack {
  readonly id?: string;
  readonly url?: string;
  readonly lang?: string;
  readonly label?: string;
  readonly kind?: string;
  readonly default?: boolean;
}

interface AnidapSourcesPayload {
  readonly sources?: readonly AnidapSourceEntry[];
  readonly tracks?: readonly AnidapTrack[] | null;
  readonly subtitles?: readonly AnidapTrack[];
  readonly headers?: Record<string, string>;
  readonly chapters?: readonly {
    readonly title?: string;
    readonly start?: number;
    readonly end?: number;
  }[];
  readonly intro?: { readonly start?: number; readonly end?: number };
  readonly outro?: { readonly start?: number; readonly end?: number };
}

interface AnidapServerSlot {
  readonly id: string;
  readonly mode: "sub" | "dub";
  readonly tip?: string;
  readonly isDefault: boolean;
}

type AnidapRequestHeaders = NonNullable<MultiSourceStreamInput["headers"]>;
type AnidapFetchInit = Omit<RequestInit, "headers"> & {
  readonly headers?: AnidapRequestHeaders;
};
type AnidapGraphqlVariables = { readonly q: string } | { readonly value: number };

function requestHeaders(extra: AnidapRequestHeaders = {}): AnidapRequestHeaders {
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
  init?: AnidapFetchInit,
): Promise<T | null> {
  const response = await providerFetch(context, url, {
    ...init,
    headers: { ...requestHeaders(), ...init?.headers },
    signal: directStreamFetchSignal(context.signal, FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderHttpError({
      providerId: ANIDAP_PROVIDER_ID,
      stage,
      status,
      message: `Anidap ${stage} returned HTTP ${status}`,
      code: status === 404 || status === 410 ? "not-found" : httpStatusToResolveErrorCode(status),
      retryable: httpStatusIsRetryable(status),
    });
  }
  return readJsonObjectBody<T>(response);
}

async function graphql<T>(
  context: ProviderRuntimeContext,
  query: string,
  variables: AnidapGraphqlVariables,
  stage: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const payload = await fetchJson<{ data?: unknown; errors?: readonly { message?: string }[] }>(
    context,
    GRAPHQL_URL,
    stage,
    {
      method: "POST",
      body: JSON.stringify({ query, variables }),
      headers: { "Content-Type": "application/json" },
    },
  );
  if (payload?.errors?.length) {
    throw new ProviderHttpError({
      providerId: ANIDAP_PROVIDER_ID,
      stage,
      message: `Anidap GraphQL ${stage} failed: ${payload.errors[0]?.message ?? "unknown error"}`,
      code: "parse-failed",
      retryable: false,
    });
  }
  if (payload?.data === undefined) return null;
  const parsed = schema.safeParse(payload.data);
  if (!parsed.success) {
    throw new ProviderHttpError({
      providerId: ANIDAP_PROVIDER_ID,
      stage,
      message: `Anidap GraphQL ${stage} returned a shape Kunai does not read`,
      code: "parse-failed",
      retryable: false,
    });
  }
  return parsed.data;
}

const ANIME_FIELDS =
  "id anilistId malId titleRomaji titleEnglish episodeCount seasonYear format type coverImage bannerImage description popularity averageScore";

const anidapSearchDataSchema = z.object({
  searchAnime: z.object({ items: z.array(anidapAnimeNodeSchema).nullish() }).nullish(),
});
const anidapLookupDataSchema = z.object({ anime: anidapAnimeNodeSchema.nullish() });

async function searchRows(query: string, context: ProviderRuntimeContext) {
  const data = await graphql(
    context,
    `query($q:String!){ searchAnime(query:$q,limit:20,includeAdult:false){ items{ ${ANIME_FIELDS} } } }`,
    { q: query },
    "search",
    anidapSearchDataSchema,
  );
  return data?.searchAnime?.items ?? [];
}

async function lookupAnime(
  context: ProviderRuntimeContext,
  key: "anilistId" | "malId",
  value: number,
): Promise<AnidapAnimeNode | null> {
  const data = await graphql(
    context,
    `query($value:Int!){ anime(${key}:$value){ ${ANIME_FIELDS} } }`,
    { value },
    "catalog lookup",
    anidapLookupDataSchema,
  );
  return data?.anime ?? null;
}

function nativeId(title: ProviderResolveInput["title"] | ProviderEpisodeListInput["title"]) {
  const native = title.externalIds?.providerNativeIds?.[ANIDAP_PROVIDER_ID];
  if (native) return native;
  if (title.id.startsWith(`${ANIDAP_PROVIDER_ID}:`)) {
    return title.id.slice(ANIDAP_PROVIDER_ID.length + 1);
  }
  return undefined;
}

async function resolveSlug(
  title: ProviderResolveInput["title"] | ProviderEpisodeListInput["title"],
  context: ProviderRuntimeContext,
): Promise<string | null> {
  const direct = nativeId(title);
  if (direct) return direct;
  const anilistId = Number(title.externalIds?.anilistId ?? title.anilistId);
  if (Number.isFinite(anilistId) && anilistId > 0) {
    const bridged = context.titleBridge?.get({
      providerId: ANIDAP_PROVIDER_ID,
      catalogKind: "anime",
      catalogId: `anilist:${anilistId}`,
    });
    if (bridged) return bridged;
    const row = await lookupAnime(context, "anilistId", anilistId).catch(() => null);
    if (row?.id) {
      context.titleBridge?.set({
        providerId: ANIDAP_PROVIDER_ID,
        catalogKind: "anime",
        catalogId: `anilist:${anilistId}`,
        nativeId: row.id,
      });
      return row.id;
    }
  }
  const malId = Number(title.externalIds?.malId ?? title.malId);
  if (Number.isFinite(malId) && malId > 0) {
    const row = await lookupAnime(context, "malId", malId).catch(() => null);
    if (row?.id) return row.id;
  }

  const rows = await searchRows(title.title, context);
  const match = matchProviderCatalogTitle(
    rows.flatMap((row) =>
      row.id
        ? [
            {
              slug: row.id,
              title: row.titleRomaji ?? row.titleEnglish ?? "",
              englishTitle: row.titleEnglish,
              altNames: Object.values(row.titles ?? {}),
              year: row.seasonYear,
            },
          ]
        : [],
    ),
    { title: title.title, year: title.year, altNames: title.aliases },
  );
  return match?.slug ?? rows[0]?.id ?? null;
}

async function fetchEpisodes(slug: string, context: ProviderRuntimeContext) {
  const rows = await fetchJson<readonly AnidapEpisode[]>(
    context,
    `${REST_BASE}/episodes?id=${encodeURIComponent(slug)}`,
    "episode catalog",
  );
  return Array.isArray(rows) ? rows : [];
}

async function fetchServers(
  slug: string,
  episode: number,
  context: ProviderRuntimeContext,
): Promise<AnidapServerSlot[]> {
  const body = await fetchJson<unknown>(
    context,
    `${REST_BASE}/servers?id=${encodeURIComponent(slug)}&epNum=${episode}`,
    "server list",
  );
  const parsed = anidapServersPayloadSchema.safeParse(body);
  const data = parsed.success ? parsed.data : null;
  const slots: AnidapServerSlot[] = [];
  const append = (entries: AnidapServersPayload["subProviders"], mode: "sub" | "dub") => {
    for (const entry of entries ?? []) {
      if (!entry.id) continue;
      slots.push({ id: entry.id, mode, tip: entry.tip, isDefault: entry.default === true });
    }
  };
  append(data?.subProviders, "sub");
  append(data?.dubProviders, "dub");
  return slots;
}

async function fetchSources(
  context: ProviderRuntimeContext,
  input: { readonly slug: string; readonly episode: number; readonly slot: AnidapServerSlot },
): Promise<AnidapSourcesPayload | null> {
  const params = new URLSearchParams({
    id: input.slug,
    epNum: String(input.episode),
    type: input.slot.mode,
    providerId: input.slot.id,
  });
  return fetchJson<AnidapSourcesPayload>(
    context,
    `${REST_BASE}/sources?${params.toString()}`,
    `sources ${input.slot.id}`,
  );
}

function xorHexEncode(value: string, keyByte: number): string {
  const bytes = new TextEncoder().encode(value);
  return [...bytes].map((byte) => (byte ^ keyByte).toString(16).padStart(2, "0")).join("");
}

/** Structural rewrites from Anidap's public player. Browser CORS proxies are not needed for mpv. */
export function transformAnidapSourceUrl(url: string, provider: string): string {
  if (provider === "shiro" && /^https?:\/\//i.test(url)) {
    return `https://hls.dramavideo.se/media/${xorHexEncode(url, 137)}&origin=https://kem.clvd.xyz/`;
  }
  let out = url;
  if (out.includes("vivibebe.site/public/stream/")) {
    out = out.replace(
      "https://vivibebe.site/public/stream/",
      "https://hawk.aniwatchtv.site/media/",
    );
  }
  if (out.startsWith("https://playeng.animeapps.top/r2/")) {
    out = `https://bd.aniwatchtv.site/media${out.replace(/https?:\/\/[^/]+/, "").replace("/r2", "")}`;
  }
  if (provider === "mochi") {
    out = out.replace("https://tools.fast4speed.rsvp", "https://mp4.24stream.xyz/storage");
  }
  if (provider === "beep") {
    if (/^https:\/\/bd\.(?:24stream\.xyz|aniwatchtv\.site)\/media/.test(out)) return out;
    if (out.startsWith("/")) return `https://bd.aniwatchtv.site/media${out.replace("/r2", "")}`;
    if (/^https?:\/\//i.test(out)) {
      return `https://bd.aniwatchtv.site/media${out.replace(/https?:\/\/[^/]+/, "").replace("/r2", "")}`;
    }
  }
  return out;
}

function collectProviderPayload(
  payload: AnidapSourcesPayload | null,
  slot: AnidapServerSlot,
  streams: MultiSourceStreamInput[],
  subtitles: MultiSourceSubtitleInput[],
): void {
  const sourceKey = `${slot.mode}-${slot.id}`;
  const sourceLabel = `${slot.mode === "dub" ? "Dub" : "Sub"} ${slot.id}`;
  const headers =
    payload?.headers && Object.keys(payload.headers).length > 0 ? payload.headers : undefined;
  const tracks = payload?.tracks ?? payload?.subtitles ?? [];
  const subtitleLanguages = [
    ...new Set(
      tracks
        .filter(
          (track) =>
            track.kind !== "thumbnails" &&
            track.lang !== "thumbnails" &&
            track.label !== "thumbnails",
        )
        .map((track) => normalizeIsoLanguageCode(track.lang ?? track.label) ?? track.lang)
        .filter((language): language is string => Boolean(language)),
    ),
  ];
  for (const track of tracks) {
    if (!track.url || track.kind === "thumbnails" || track.url.includes(":///")) continue;
    subtitles.push({
      sourceKey,
      url: track.url,
      language: normalizeIsoLanguageCode(track.lang ?? track.label) ?? track.lang,
      label: track.label ?? track.lang,
      type: track.url,
    });
  }
  const timing: NonNullable<MultiSourceStreamInput["metadata"]> = {};
  const chapters = payload?.chapters ?? [];
  const intro = payload?.intro ?? chapters.find((chapter) => /intro/i.test(chapter.title ?? ""));
  const outro =
    payload?.outro ?? chapters.find((chapter) => /outro|ed\b|ending/i.test(chapter.title ?? ""));
  if (intro) timing.intro = { start: intro.start ?? 0, end: intro.end ?? 0 };
  if (outro) timing.outro = { start: outro.start ?? 0, end: outro.end ?? 0 };
  for (const source of payload?.sources ?? []) {
    if (!source.url || source.url.includes(":///")) continue;
    const type = source.type?.toLowerCase() ?? "";
    streams.push({
      sourceKey,
      sourceLabel,
      url: transformAnidapSourceUrl(source.url, slot.id),
      qualityHint: source.quality,
      protocol:
        type.includes("mpegurl") || type.includes("m3u8")
          ? "hls"
          : type.includes("mp4")
            ? "mp4"
            : undefined,
      audioLanguages: [slot.mode === "dub" ? "en" : "ja"],
      presentation: slot.mode,
      subtitleDelivery: subtitleLanguages.length > 0 ? "external" : undefined,
      subtitleLanguages,
      headers,
      metadata: {
        audioMode: slot.mode,
        upstreamProvider: slot.id,
        upstreamTip: slot.tip,
        defaultServer: slot.isDefault,
        ...timing,
      },
    });
  }
}

function episodeNumberFromIdentity(input: ProviderResolveInput): number | undefined {
  const identity = input.episode?.providerEpisodeIdentity;
  if (identity?.providerId !== ANIDAP_PROVIDER_ID) return undefined;
  const match = /^ep:(\d+)$/.exec(identity.value);
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

async function fetchAnidapPayload(
  input: ProviderResolveInput,
  context: ProviderRuntimeContext,
): Promise<MultiSourceResolvePayload | null> {
  const slug = await resolveSlug(input.title, context);
  if (!slug) return null;
  const episode = episodeNumberFromIdentity(input) ?? selectProviderEpisodeNumber(input.episode);
  const episodes = await fetchEpisodes(slug, context);
  const episodeRow = episodes.find((row) => row.number === episode);
  if (!episodeRow) return null;
  const preferredSource = /^source:anidap:(sub|dub)[-_]([a-z0-9-]+)$/.exec(
    input.preferredSourceId ?? "",
  );
  const preferredMode =
    preferredSource?.[1] === "dub" ? "dub" : preferredSource?.[1] === "sub" ? "sub" : undefined;
  const mode =
    preferredMode ??
    resolveAnimeAudioIntent(
      input.preferredAudioLanguage ?? input.preferredPresentation ?? "original",
    ).catalogMode;
  if (mode === "dub" && episodeRow.hasDub === false) {
    throw new ProviderHttpError({
      providerId: ANIDAP_PROVIDER_ID,
      stage: "sources",
      message: `Anidap episode ${episode} has no dub audio`,
      code: "not-found",
      retryable: false,
    });
  }
  if (mode === "sub" && episodeRow.hasSub === false) {
    throw new ProviderHttpError({
      providerId: ANIDAP_PROVIDER_ID,
      stage: "sources",
      message: `Anidap episode ${episode} has no sub audio`,
      code: "not-found",
      retryable: false,
    });
  }

  const slots = await fetchServers(slug, episode, context);
  let modeSlots = slots.filter((slot) => slot.mode === mode);
  if (preferredSource?.[2]) {
    modeSlots = [
      ...modeSlots.filter((slot) => slot.id === preferredSource[2]),
      ...modeSlots.filter((slot) => slot.id !== preferredSource[2] && slot.isDefault),
      ...modeSlots.filter((slot) => slot.id !== preferredSource[2] && !slot.isDefault),
    ];
  } else {
    modeSlots = [
      ...modeSlots.filter((slot) => slot.isDefault),
      ...modeSlots.filter((slot) => !slot.isDefault),
    ];
  }
  if (modeSlots.length === 0) return null;

  const streams: MultiSourceStreamInput[] = [];
  const subtitles: MultiSourceSubtitleInput[] = [];
  const emptySources: MultiSourceEmptySourceInput[] = [];
  const results = await Promise.all(
    modeSlots.slice(0, 6).map(async (slot) => {
      try {
        return { slot, payload: await fetchSources(context, { slug, episode, slot }) };
      } catch {
        return { slot, payload: null };
      }
    }),
  );
  for (const { slot, payload } of results) {
    const before = streams.length;
    collectProviderPayload(payload, slot, streams, subtitles);
    if (streams.length === before) {
      emptySources.push({
        sourceKey: `${slot.mode}-${slot.id}`,
        label: `${slot.mode === "dub" ? "Dub" : "Sub"} ${slot.id}`,
        metadata: { audioMode: slot.mode, upstreamProvider: slot.id, upstreamTip: slot.tip },
      });
    }
  }
  const oppositeSlots = slots.filter((slot) => slot.mode !== mode);
  for (const slot of oppositeSlots) {
    emptySources.push({
      sourceKey: `${slot.mode}-${slot.id}`,
      label: `${slot.mode === "dub" ? "Dub" : "Sub"} ${slot.id}`,
      metadata: { audioMode: slot.mode, upstreamProvider: slot.id, upstreamTip: slot.tip },
    });
  }

  return {
    streams,
    subtitles,
    emptySources,
    externalIds: {
      anilistId: input.title.externalIds?.anilistId ?? input.title.anilistId,
      malId: input.title.externalIds?.malId ?? input.title.malId,
      providerNativeIds: { [ANIDAP_PROVIDER_ID]: slug },
    },
  };
}

export const anidapProviderModule: CoreProviderModule = {
  providerId: ANIDAP_PROVIDER_ID,
  manifest: anidapManifest,

  async search(
    input: ProviderSearchInput,
    context,
  ): Promise<readonly ProviderSearchResult[] | null> {
    let rows: readonly AnidapAnimeNode[];
    try {
      rows = await searchRows(input.query, context);
    } catch {
      return null;
    }
    return rows.slice(0, 40).map((row) => {
      const title = row.titleEnglish ?? row.titleRomaji ?? row.id ?? "Untitled";
      const cover = row.coverImage?.extraLarge ?? row.coverImage?.large;
      return {
        id: row.id ?? "",
        type: "series" as const,
        title,
        year: row.seasonYear ? String(row.seasonYear) : undefined,
        overview: row.description,
        posterPath: cover ?? null,
        metadataSource: "Anidap",
        rating: row.averageScore ? row.averageScore / 10 : null,
        popularity: row.popularity,
        episodeCount: row.episodeCount ?? undefined,
        subtitleAvailability: "softsub" as const,
        englishTitle: row.titleEnglish,
        nativeTitle: row.titleRomaji,
        externalIds: {
          anilistId: row.anilistId ? String(row.anilistId) : undefined,
          malId: row.malId ? String(row.malId) : undefined,
          providerNativeIds: row.id ? { [ANIDAP_PROVIDER_ID]: row.id } : undefined,
        },
        artwork: { posterUrl: cover, backdropUrl: row.bannerImage },
      };
    });
  },

  async listEpisodes(
    input: ProviderEpisodeListInput,
    context,
  ): Promise<readonly ProviderEpisodeOption[] | null> {
    try {
      const slug = await resolveSlug(input.title, context);
      if (!slug) return null;
      const episodes = await fetchEpisodes(slug, context);
      return episodes.flatMap((row) => {
        if (!row.number) return [];
        const title = row.titles?.en ?? row.titles?.["x-jat"] ?? row.titles?.ja;
        return [
          {
            index: row.number,
            label: formatAnimeEpisodeLabel(row.number, title),
            ...(title ? { name: title } : null),
            detail: `Episode ${row.number}`,
            totalEpisodeCount: episodes.length,
            providerEpisodeIdentity: { providerId: ANIDAP_PROVIDER_ID, value: `ep:${row.number}` },
            release: row.airDateUtc
              ? { airDate: row.airDateUtc, status: "released" as const }
              : undefined,
            artwork: row.img ? { thumbnailUrl: row.img } : undefined,
          },
        ];
      });
    } catch {
      return null;
    }
  },

  async resolve(input, context) {
    return resolveMultiSourceProvider({
      providerId: ANIDAP_PROVIDER_ID,
      label: "Anidap",
      input,
      context,
      supportedMediaKinds: ["anime"],
      unsupportedMessage: "Anidap only supports anime",
      traceMessage: "Resolved Anidap server-slot stream",
      fetchPayload: () => fetchAnidapPayload(input, context),
    });
  },
};
