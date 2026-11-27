import type { CoreProviderModule } from "@kunai/core";
import { isJsonObject, isJsonString, type JsonValue } from "@kunai/types";
import type {
  ProviderEpisodeListInput,
  ProviderResolveInput,
  ProviderRuntimeContext,
  ProviderSearchInput,
  TitleIdentity,
} from "@kunai/types";

import { isAnimeDubAudioPreference } from "../shared/anime-audio-intent";
import { formatAnimeEpisodeLabel } from "../shared/anime-metadata";
import { parseHlsMasterMaxHeight } from "../shared/hls-ladder";
import { readJsonObjectBody } from "../shared/json-body";
import {
  resolveMultiSourceProvider,
  type MultiSourceResolvePayload,
  type MultiSourceSubtitleInput,
} from "../shared/multi-source-resolver";
import { selectProviderEpisodeNumber } from "../shared/provider-episode-number";
import { createDirectProviderResponseFetch } from "../shared/provider-json-fetch";
import { matchProviderCatalogTitle } from "../shared/provider-title-match";
import { ANIMEPARADISE_PROVIDER_ID, animeparadiseManifest } from "./manifest";

export { ANIMEPARADISE_PROVIDER_ID };

const SITE = "https://www.animeparadise.moe";
const API = "https://api.animeparadise.moe";
const MEDIA = "https://stream.animeparadise.moe";
const HEADERS = { Referer: `${SITE}/` };
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const EPISODE_UID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const OPAQUE_LOCATOR = /^[A-Za-z0-9_-]{1,2048}$/;

const get = createDirectProviderResponseFetch(ANIMEPARADISE_PROVIDER_ID, "AnimeParadise", 6_000);

interface AnimeRow {
  readonly _id?: string;
  readonly title?: string;
  readonly link?: string;
  readonly episodeCount?: number;
  readonly animeSeason?: { readonly year?: number };
  readonly alternativeTitle?: {
    readonly english?: string;
    readonly native?: string;
    readonly romaji?: string;
  };
  readonly mappings?: { readonly anilist?: number; readonly myanimelist?: number };
  readonly posterImage?: { readonly large?: string };
}

interface EpisodeRow {
  readonly uid?: string;
  readonly number?: string;
  readonly title?: string;
}

interface ApiResult<T> {
  readonly success?: boolean;
  readonly data?: T;
}

async function json<T>(
  context: ProviderRuntimeContext,
  path: string,
  stage: string,
): Promise<T | undefined> {
  const body = await readJsonObjectBody<ApiResult<T>>(await get(context, `${API}${path}`, stage));
  return body?.success === true ? body.data : undefined;
}

async function searchRows(
  context: ProviderRuntimeContext,
  query: string,
): Promise<readonly AnimeRow[]> {
  if (!query.trim()) return [];
  const rows = await json<readonly AnimeRow[]>(
    context,
    `/search?${new URLSearchParams({ q: query })}`,
    "search",
  );
  return Array.isArray(rows) ? rows : [];
}

async function nativeId(
  title: TitleIdentity,
  context: ProviderRuntimeContext,
): Promise<string | undefined> {
  const direct =
    title.externalIds?.providerNativeIds?.[ANIMEPARADISE_PROVIDER_ID] ??
    (title.id.startsWith("animeparadise:") ? title.id.slice("animeparadise:".length) : undefined);
  if (direct && SAFE_ID.test(direct)) return direct;
  const anilistId = title.anilistId ?? title.externalIds?.anilistId;
  const malId = title.malId ?? title.externalIds?.malId;
  const catalogId = anilistId ? `anilist:${anilistId}` : malId ? `mal:${malId}` : undefined;
  const bridge = catalogId
    ? { providerId: ANIMEPARADISE_PROVIDER_ID, catalogKind: "anime" as const, catalogId }
    : undefined;
  const cached = bridge && context.titleBridge?.get(bridge);
  if (cached && SAFE_ID.test(cached)) return cached;
  const rows = await searchRows(context, title.title);
  const match = matchProviderCatalogTitle(
    rows.flatMap((row) => {
      if (!row?._id || !SAFE_ID.test(row._id) || !row.title) return [];
      const titles = row.alternativeTitle;
      return [
        {
          slug: row._id,
          row,
          title: row.title,
          englishTitle: titles?.english,
          altNames: [titles?.native ?? "", titles?.romaji ?? ""],
          year: row.animeSeason?.year,
        },
      ];
    }),
    { title: title.title, year: title.year, altNames: title.aliases },
  );
  if (!match) return undefined;
  if (!bridge) return match.slug;
  if (!match.row.link || !SAFE_ID.test(match.row.link)) return undefined;
  const detail = await json<AnimeRow>(context, `/anime/${match.row.link}`, "catalog identity");
  if (detail?._id !== match.slug) return undefined;
  const mapped = detail.mappings;
  if (
    (anilistId && String(mapped?.anilist) !== anilistId) ||
    (!anilistId && malId && String(mapped?.myanimelist) !== malId)
  ) {
    return undefined;
  }
  context.titleBridge?.set({ ...bridge, nativeId: match.slug });
  return match.slug;
}

async function episodes(
  id: string,
  context: ProviderRuntimeContext,
): Promise<readonly EpisodeRow[]> {
  const rows = await json<readonly EpisodeRow[]>(
    context,
    `/anime/${id}/episode`,
    "episode catalog",
  );
  return Array.isArray(rows) ? rows : [];
}

function numberOf(row: EpisodeRow): number | undefined {
  if (!row?.number || !/^[1-9]\d*$/.test(row.number)) return undefined;
  const episode = Number(row.number);
  return Number.isSafeInteger(episode) ? episode : undefined;
}

/**
 * Read — never execute — the watch page's own module list, then at most two
 * same-site bundle chunks for the `getEpisode` server-action id. The id
 * rotates per deployment, so nothing about it is persisted or hardcoded.
 */
async function episodeAction(
  watch: string,
  context: ProviderRuntimeContext,
): Promise<string | undefined> {
  const html = await (await get(context, watch, "watch")).text();
  const watchModule = /I\[\d+,\[([^\]]+)\],\\"WatchProvider\\"\]/.exec(html)?.[1];
  if (!watchModule) return undefined;
  const chunks = [
    ...new Set(
      [...watchModule.matchAll(/\/_next\/static\/chunks\/[\w-]+\.js/g)].map(([path]) => path),
    ),
  ].slice(-2);
  const bundles = await Promise.all(
    chunks.map(async (path) => (await get(context, `${SITE}${path}`, "watch bundle")).text()),
  );
  for (const bundle of bundles) {
    const id = /createServerReference\)\("([a-f0-9]{42})",[^;]{0,250},"getEpisode"\)/.exec(
      bundle,
    )?.[1];
    if (id) return id;
  }
  return undefined;
}

function flightEpisode(body: string, uid: string, id: string) {
  for (const line of body.split("\n")) {
    const row = /^[0-9a-f]+:(\{.*\})$/i.exec(line)?.[1];
    if (!row) continue;
    try {
      const decoded: unknown = JSON.parse(row);
      if (!isJsonObject(decoded) || !isJsonObject(decoded.episode)) continue;
      const ep = decoded.episode;
      if (
        ep.uid === uid &&
        ep.origin === id &&
        isJsonString(ep.streamLink) &&
        OPAQUE_LOCATOR.test(ep.streamLink)
      ) {
        return ep;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function subtitleRows(data: JsonValue | undefined): MultiSourceSubtitleInput[] {
  if (!Array.isArray(data)) return [];
  const rows: MultiSourceSubtitleInput[] = [];
  for (const track of data) {
    if (!isJsonObject(track) || !isJsonString(track.src)) continue;
    const label = isJsonString(track.label) ? track.label : undefined;
    if (track.type === "ass" && SAFE_ID.test(track.src)) {
      rows.push({
        sourceKey: "animeparadise",
        label,
        url: `${API}/stream/file/${track.src}`,
        type: "text/x-ass",
      });
    } else if (track.type === "vtt" && URL.canParse(track.src)) {
      const url = new URL(track.src);
      if (url.origin === MEDIA && !url.username && !url.password && url.pathname === "/captions") {
        rows.push({ sourceKey: "animeparadise", label, url: url.href, type: "text/vtt" });
      }
    }
  }
  return rows;
}

async function fetchPayload(
  input: ProviderResolveInput,
  context: ProviderRuntimeContext,
): Promise<MultiSourceResolvePayload | null> {
  if (
    isAnimeDubAudioPreference(
      input.preferredAudioLanguage ?? input.preferredPresentation ?? "original",
    )
  ) {
    return null;
  }
  const id = await nativeId(input.title, context);
  if (!id) return null;
  const list = await episodes(id, context);
  const selected = input.episode?.providerEpisodeIdentity;
  const row =
    selected?.providerId === ANIMEPARADISE_PROVIDER_ID
      ? list.find((ep) => ep?.uid === selected.value)
      : list.find((ep) => numberOf(ep) === selectProviderEpisodeNumber(input.episode));
  const uid = row?.uid;
  if (!uid || !EPISODE_UID.test(uid)) return null;
  const watch = `${SITE}/watch/${uid}?${new URLSearchParams({ origin: id })}`;
  const action = await episodeAction(watch, context);
  if (!action) return null;
  const flight = await get(context, watch, "episode action", {
    method: "POST",
    headers: {
      Accept: "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
      Origin: SITE,
      Referer: watch,
      "Next-Action": action,
    },
    body: JSON.stringify([uid, id]),
  });
  const result = flightEpisode(await flight.text(), uid, id);
  if (!result || !isJsonString(result.streamLink)) return null;
  const url = `${MEDIA}/m3u8?${new URLSearchParams({ url: result.streamLink })}`;
  const master = await (await get(context, url, "manifest", { headers: HEADERS })).text();
  if (!master.trimStart().startsWith("#EXTM3U")) return null;
  const height = parseHlsMasterMaxHeight(master);
  const subtitles = subtitleRows(result.subData);
  return {
    streams: [
      {
        sourceKey: "animeparadise",
        sourceLabel: "AnimeParadise",
        url,
        qualityHint: height ? `${height}p` : undefined,
        protocol: "hls" as const,
        presentation: "sub" as const,
        headers: HEADERS,
        subtitleDelivery: subtitles.length ? ("external" as const) : undefined,
      },
    ],
    subtitles,
    externalIds: { providerNativeIds: { [ANIMEPARADISE_PROVIDER_ID]: id } },
  };
}

export const animeparadiseProviderModule: CoreProviderModule = {
  providerId: ANIMEPARADISE_PROVIDER_ID,
  manifest: animeparadiseManifest,

  async search(input: ProviderSearchInput, context: ProviderRuntimeContext) {
    try {
      return (await searchRows(context, input.query)).flatMap((row) =>
        !row?._id || !SAFE_ID.test(row._id) || !row.title
          ? []
          : [
              {
                id: row._id,
                type: "series" as const,
                title: row.title,
                englishTitle: row.alternativeTitle?.english,
                nativeTitle: row.alternativeTitle?.native,
                year: row.animeSeason?.year?.toString(),
                episodeCount: row.episodeCount,
                posterPath: row.posterImage?.large,
                metadataSource: "animeparadise",
                externalIds: {
                  providerNativeIds: { [ANIMEPARADISE_PROVIDER_ID]: row._id },
                },
              },
            ],
      );
    } catch {
      return null;
    }
  },

  async listEpisodes(input: ProviderEpisodeListInput, context: ProviderRuntimeContext) {
    try {
      const id = await nativeId(input.title, context);
      if (!id) return null;
      const rows = await episodes(id, context);
      return rows.flatMap((row) => {
        const index = numberOf(row);
        if (index === undefined || !row.uid || !EPISODE_UID.test(row.uid)) return [];
        return [
          {
            index,
            name: row.title,
            label: formatAnimeEpisodeLabel(index, row.title),
            providerEpisodeIdentity: { providerId: ANIMEPARADISE_PROVIDER_ID, value: row.uid },
          },
        ];
      });
    } catch {
      return null;
    }
  },

  resolve: (input, context) =>
    resolveMultiSourceProvider({
      providerId: ANIMEPARADISE_PROVIDER_ID,
      label: "AnimeParadise",
      input,
      context,
      supportedMediaKinds: ["anime"],
      unsupportedMessage: "AnimeParadise only supports anime",
      requireVerifiedStream: true,
      fetchPayload: () => fetchPayload(input, context),
    }),
};
