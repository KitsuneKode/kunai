/**
 * KickAssAnime — an independent anime source with separate subtitle tracks.
 *
 * Shares nothing with Miruro: own catalog (slugs like `naruto-f3cf`), own site,
 * own player. Unlike AnimeGG it ships subtitles as `.vtt` tracks rather than
 * burned in, so it is the anime source that can offer a subtitle choice.
 *
 * Parsing lives in `site.ts`; this file is the runtime contract around it.
 */
import { createResolveTrace, type CoreProviderModule } from "@kunai/core";
import type {
  CachePolicy,
  ProviderEpisodeOption,
  ProviderResolveResult,
  ProviderRuntimeContext,
  ProviderSearchResult,
  ProviderSourceCandidate,
  ProviderTraceEvent,
  ProviderVariantCandidate,
  StreamCandidate,
  SubtitleCandidate,
  TitleIdentity,
} from "@kunai/types";

import { resolveAnimeAudioIntent } from "../shared/anime-audio-intent";
import { formatAnimeSourceDetail } from "../shared/anime-source-presentation";
import { directStreamFetchSignal } from "../shared/direct-stream-source";
import { parseHlsMasterAudioRenditions, type HlsAudioRendition } from "../shared/hls-ladder";
import { selectProviderEpisodeNumber } from "../shared/provider-episode-number";
import { matchProviderCatalogTitle } from "../shared/provider-title-match";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import {
  createSourceCandidateFromStream,
  createStreamId,
  createVariantCandidateFromStream,
} from "../shared/source-inventory";
import { selectReadyStream } from "../shared/startup-selection";
import { inferSubtitleFormat, normalizeIsoLanguageCode } from "../shared/subtitle-helpers";
import { kickassanimeManifest, KICKASSANIME_PROVIDER_ID } from "./manifest";
import {
  kaaEpisodeNumbers,
  kaaPageForEpisode,
  parseKaaEpisodePage,
  parseKaaPlayerPage,
  parseKaaSearchResults,
  parseKaaServers,
  type KaaSearchResult,
  type KaaServer,
} from "./site";

export { KICKASSANIME_PROVIDER_ID };

const PRIMARY_BASE = "https://kaa.lt";
/** Still redirects to whatever the current domain is; asked only when kaa.lt fails. */
const REDIRECTING_ALIAS = "https://kickass-anime.ro/";
const KAA_FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** The only server whose stream played end to end; see the manifest notes. */
const PLAYABLE_SERVERS = new Set(["VidStreaming"]);

const SUB_LOCALE = "ja-JP";
const DUB_LOCALE = "en-US";

let currentBase = PRIMARY_BASE;

type Requester = (input: string, init?: RequestInit) => Promise<Response>;

function requester(context: ProviderRuntimeContext): Requester {
  return context.fetch?.fetch.bind(context.fetch) ?? fetch;
}

/**
 * The domain has rotated four times. When the current one stops answering at
 * all, the old alias's redirect names the new one, and the answer is kept for
 * the process. Only a dead connection is a reason to look: an HTTP error means
 * the site answered, and a cancelled play is not the site's fault.
 */
async function kaaFetch(
  context: ProviderRuntimeContext,
  path: string,
  init: { readonly method?: "GET" | "POST"; readonly body?: unknown },
): Promise<Response> {
  const attempt = (base: string) =>
    requester(context)(`${base}${path}`, {
      method: init.method ?? "GET",
      headers: {
        accept: "application/json",
        referer: `${base}/`,
        origin: base,
        "user-agent": USER_AGENT,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: directStreamFetchSignal(context.signal, KAA_FETCH_TIMEOUT_MS),
    });
  try {
    return await attempt(currentBase);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    const rotated = await discoverBase(context);
    if (!rotated || rotated === currentBase) throw error;
    currentBase = rotated;
    return attempt(currentBase);
  }
}

/**
 * Where the alias lands now. Landing on the alias itself is no answer — asking
 * it directly would turn every POST into a GET at the redirect.
 */
async function discoverBase(context: ProviderRuntimeContext): Promise<string | null> {
  try {
    const response = await requester(context)(REDIRECTING_ALIAS, {
      headers: { "user-agent": USER_AGENT },
      signal: directStreamFetchSignal(context.signal, KAA_FETCH_TIMEOUT_MS),
    });
    void response.body?.cancel().catch(() => {});
    if (!response.url) return null;
    const landed = new URL(response.url).origin;
    return landed === new URL(REDIRECTING_ALIAS).origin ? null : landed;
  } catch {
    return null;
  }
}

async function fetchJson(
  context: ProviderRuntimeContext,
  path: string,
  init: { readonly method?: "GET" | "POST"; readonly body?: unknown } = {},
): Promise<unknown> {
  const response = await kaaFetch(context, path, init);
  if (!response.ok) throw new Error(`KickAssAnime returned HTTP ${response.status}`);
  return response.json();
}

/**
 * Which audio mpv will actually play, and under which name.
 *
 * A KickAssAnime master carries every dub as a rendition of one file — Frieren
 * ships nine, Japanese marked DEFAULT — so sub and dub can be the same URL. The
 * track is chosen by mpv's `--alang`, which follows the user's audio setting:
 * a dub asks for English, a sub takes the default. Reading the group is what
 * lets the source say "Dub" only when there is really an English track behind
 * it, rather than relabelling the Japanese one.
 */
export function selectKaaAudio(
  renditions: readonly HlsAudioRendition[],
  wanted: "sub" | "dub",
): {
  readonly presentation: "sub" | "dub";
  readonly language: string;
  readonly nativeLabel?: string;
} {
  const english = renditions.find((track) => /^en/i.test(track.language ?? ""));
  if (wanted === "dub" && english) {
    return {
      presentation: "dub",
      language: "en",
      ...(english.name ? { nativeLabel: english.name } : {}),
    };
  }
  // `--alang=orig` resolves to whichever track the manifest marks DEFAULT, so
  // that track is what a sub actually plays — not necessarily Japanese.
  const fallback = renditions.find((track) => track.isDefault) ?? renditions[0];
  const language = normalizeIsoLanguageCode(fallback?.language) ?? "ja";
  return {
    presentation: "sub",
    language,
    ...(fallback?.name ? { nativeLabel: fallback.name } : {}),
  };
}

async function fetchMasterPlaylist(
  context: ProviderRuntimeContext,
  url: string,
  headers: Record<string, string>,
): Promise<string | null> {
  try {
    const response = await requester(context)(url, {
      headers,
      signal: directStreamFetchSignal(context.signal, KAA_FETCH_TIMEOUT_MS),
    });
    return response.ok ? await response.text() : null;
  } catch {
    // A master this adapter cannot read is not a dead stream: mpv fetches it
    // again itself. Only the audio naming is lost, so the sub label stands.
    return null;
  }
}

async function fetchPlayerPage(
  context: ProviderRuntimeContext,
  server: KaaServer,
): Promise<string> {
  const response = await requester(context)(server.src, {
    headers: { referer: `${currentBase}/`, "user-agent": USER_AGENT },
    signal: directStreamFetchSignal(context.signal, KAA_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`KickAssAnime player returned HTTP ${response.status}`);
  return response.text();
}

/**
 * The show slug a title already carries. A stored provider-native id came from
 * KickAssAnime itself; a bare title id is only trusted when it has the site's
 * shape (`naruto-f3cf`), so an AniList id or another site's slug is never sent
 * as one.
 */
export function resolveKaaSlug(title: TitleIdentity): string | null {
  const native = title.externalIds?.providerNativeIds?.[KICKASSANIME_PROVIDER_ID]?.trim();
  if (native && /^[a-z0-9][a-z0-9-]*$/.test(native)) return native;
  const id = title.id?.trim();
  return id && KAA_SLUG_SHAPE.test(id) ? id : null;
}

const KAA_SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{4}$/;

/**
 * The one search row that is this title — same romaji or English name, and the
 * same year when both sides know it — through the matcher AnimeGG shares. The
 * site exposes no AniList or MAL id, so anything short of exactly one such row
 * is no match: a wrong show played confidently is worse than falling through.
 */
export function matchKaaShow(
  rows: readonly KaaSearchResult[],
  title: Pick<TitleIdentity, "title" | "year">,
): string | null {
  return matchProviderCatalogTitle(rows, { title: title.title, year: title.year })?.slug ?? null;
}

/**
 * The show for a title found in another catalog — which is every title when
 * this provider is the fallback behind Miruro. Matched once by name, then
 * remembered against the AniList id so the next play asks nothing.
 */
async function locateKaaShow(
  title: TitleIdentity,
  context: ProviderRuntimeContext,
  events: ProviderTraceEvent[],
): Promise<string | null> {
  const own = resolveKaaSlug(title);
  if (own) return own;

  const anilistId = title.externalIds?.anilistId ?? title.anilistId;
  const bridgeKey = anilistId
    ? { providerId: KICKASSANIME_PROVIDER_ID, catalogKind: "anime" as const, catalogId: anilistId }
    : undefined;
  const remembered = bridgeKey ? context.titleBridge?.get(bridgeKey) : undefined;
  if (remembered && KAA_SLUG_SHAPE.test(remembered)) return remembered;

  const query = title.title.trim();
  if (!query) return null;
  const rows = parseKaaSearchResults(
    await fetchJson(context, "/api/fsearch", { method: "POST", body: { query, page: 1 } }),
  );
  const slug = matchKaaShow(rows, title);
  if (!slug) return null;
  if (bridgeKey) context.titleBridge?.set({ ...bridgeKey, nativeId: slug });
  emitTraceEvent(events, context, {
    type: "source:success",
    providerId: KICKASSANIME_PROVIDER_ID,
    sourceId: `source:${KICKASSANIME_PROVIDER_ID}:title-match`,
    message: `Matched "${title.title}" to KickAssAnime ${slug} by name and year`,
    attributes: { slug },
  });
  return slug;
}

/**
 * The player's own origin, from which every stream header is derived. Each hop
 * wants a different one — the manifest a referer, segments and subtitles an
 * Origin — and deriving both from the player keeps them right if it moves host.
 */
export function kaaStreamHeaders(playerUrl: string): Record<string, string> {
  const origin = new URL(playerUrl).origin;
  return { referer: `${origin}/`, origin, "user-agent": USER_AGENT };
}

export const kickassanimeProviderModule: CoreProviderModule = {
  providerId: KICKASSANIME_PROVIDER_ID,
  manifest: kickassanimeManifest,

  async search(input, context) {
    const query = input.query.trim();
    if (!query) return null;
    const results = parseKaaSearchResults(
      await fetchJson(context, "/api/fsearch", { method: "POST", body: { query, page: 1 } }),
    );
    if (results.length === 0) return null;

    return results.map((result): ProviderSearchResult => {
      const posterUrl = result.posterKey
        ? `${currentBase}/image/poster/${result.posterKey}.webp`
        : undefined;
      return {
        id: result.slug,
        type: result.type === "movie" ? "movie" : "series",
        title: result.title,
        metadataSource: "KickAssAnime",
        posterPath: posterUrl ?? null,
        ...(posterUrl ? { artwork: { posterUrl, thumbnailUrl: posterUrl } } : {}),
        ...(result.year ? { year: String(result.year) } : {}),
        ...(result.episodeCount ? { episodeCount: result.episodeCount } : {}),
        ...(result.englishTitle ? { englishTitle: result.englishTitle } : {}),
        availableAudioModes: [
          ...(result.locales.includes(SUB_LOCALE) ? (["sub"] as const) : []),
          ...(result.locales.includes(DUB_LOCALE) ? (["dub"] as const) : []),
        ],
        externalIds: { providerNativeIds: { [KICKASSANIME_PROVIDER_ID]: result.slug } },
      };
    });
  },

  async listEpisodes(input, context) {
    const slug = await locateKaaShow(input.title, context, []);
    if (!slug) return null;
    const page = parseKaaEpisodePage(
      await fetchJson(context, `/api/show/${slug}/episodes?ep=1&lang=${SUB_LOCALE}`),
    );
    const numbers = kaaEpisodeNumbers(page);
    if (numbers.length === 0) return null;
    // Titles and stills come only with the first page's rows; later episodes
    // keep a plain label rather than costing one request per hundred.
    const details = new Map(page.episodes.map((row) => [row.number, row]));
    return numbers.map((episode): ProviderEpisodeOption => {
      const row = details.get(episode);
      const stillUrl = row?.thumbnailKey
        ? `${currentBase}/image/thumbnail/${row.thumbnailKey}.webp`
        : undefined;
      return {
        index: episode,
        label: `Episode ${episode}`,
        ...(row?.title ? { name: row.title } : {}),
        ...(stillUrl ? { artwork: { thumbnailUrl: stillUrl } } : {}),
        totalEpisodeCount: numbers.length,
        externalIds: { providerNativeIds: { [KICKASSANIME_PROVIDER_ID]: slug } },
      };
    });
  },

  async resolve(input, context) {
    const startedAt = context.now();
    const events: ProviderTraceEvent[] = [];
    const cachePolicy: CachePolicy = kickassanimeManifest.cachePolicy;
    const fail = (
      code: Parameters<typeof createExhaustedResult>[3]["code"],
      message: string,
      retryable = false,
    ) =>
      createExhaustedResult(
        input,
        context,
        KICKASSANIME_PROVIDER_ID,
        { code, message, retryable },
        { cachePolicy, events, startedAt },
      );

    if (input.mediaKind !== "anime")
      return fail("unsupported-title", "KickAssAnime only supports anime");
    let slug: string | null;
    try {
      slug = await locateKaaShow(input.title, context, events);
    } catch (error) {
      return fail("network-error", `KickAssAnime search failed: ${describe(error)}`, true);
    }
    if (!slug) {
      const year = input.title.year ? ` (${input.title.year})` : "";
      return fail(
        "not-found",
        `KickAssAnime has no show that is clearly "${input.title.title}"${year}`,
      );
    }

    const episode = selectProviderEpisodeNumber(input.episode);
    const audio = resolveAnimeAudioIntent(input.preferredAudioLanguage ?? "original");

    // Try the requested audio first, then the other one — announced, not silent.
    // The locale picks the episode listing, not the audio: a dub is often a
    // rendition of the same file. Asking the dub listing first still matters —
    // where the two differ, its episode slug is the one with an English track.
    const attempts =
      audio.catalogMode === "dub" ? [DUB_LOCALE, SUB_LOCALE] : [SUB_LOCALE, DUB_LOCALE];
    let located: { locale: string; epSlug: string } | null = null;
    try {
      for (const locale of attempts) {
        const first = parseKaaEpisodePage(
          await fetchJson(context, `/api/show/${slug}/episodes?ep=1&lang=${locale}`),
        );
        const pageNumber = kaaPageForEpisode(first, episode);
        if (!pageNumber) continue;
        const page =
          pageNumber === 1
            ? first
            : parseKaaEpisodePage(
                await fetchJson(
                  context,
                  `/api/show/${slug}/episodes?ep=${pageNumber}&lang=${locale}`,
                ),
              );
        const hit = page.episodes.find((row) => row.number === episode);
        if (hit) {
          located = { locale, epSlug: hit.slug };
          break;
        }
      }
    } catch (error) {
      return fail("network-error", `KickAssAnime episode list failed: ${describe(error)}`, true);
    }
    if (!located) return fail("not-found", `KickAssAnime has no episode ${episode} for ${slug}`);

    let server: KaaServer | undefined;
    let player: ReturnType<typeof parseKaaPlayerPage> = null;
    try {
      const servers = parseKaaServers(
        await fetchJson(context, `/api/show/${slug}/episode/ep-${episode}-${located.epSlug}`),
      );
      server = servers.find((candidate) => PLAYABLE_SERVERS.has(candidate.name));
      if (server) player = parseKaaPlayerPage(await fetchPlayerPage(context, server));
    } catch (error) {
      return fail("network-error", `KickAssAnime player failed: ${describe(error)}`, true);
    }
    if (!server || !player) {
      return fail("not-found", `KickAssAnime offered no playable server for ${slug} ${episode}`);
    }

    const headers = kaaStreamHeaders(server.src);
    const master = await fetchMasterPlaylist(context, player.manifest, headers);
    const selected = selectKaaAudio(
      master ? parseHlsMasterAudioRenditions(master) : [],
      audio.catalogMode,
    );
    const presentation = selected.presentation;
    if (presentation !== audio.catalogMode) {
      emitTraceEvent(events, context, {
        type: "audio:fallback",
        providerId: KICKASSANIME_PROVIDER_ID,
        message: `KickAssAnime has no ${audio.catalogMode} for episode ${episode}; playing ${presentation}`,
      });
    }
    const sourceId = `source:${KICKASSANIME_PROVIDER_ID}:${server.name.toLowerCase()}:${presentation}`;
    const stream: StreamCandidate = {
      id: createStreamId(KICKASSANIME_PROVIDER_ID, [slug, episode, presentation, player.manifest]),
      providerId: KICKASSANIME_PROVIDER_ID,
      sourceId,
      url: player.manifest,
      protocol: "hls",
      container: "m3u8",
      headers,
      // The master is a ladder (360p/540p/720p); mpv picks the rendition.
      // The master is a ladder mpv picks from, and its variant playlists are
      // video-only — the audio lives in the rendition group, so splitting the
      // ladder into per-quality URLs would hand mpv silent video.
      qualityLabel: "auto",
      qualityRank: 0,
      presentation,
      audioLanguages: [selected.language],
      ...(selected.nativeLabel
        ? {
            languageEvidence: [
              {
                role: "audio" as const,
                normalizedLanguage: selected.language,
                nativeLabel: selected.nativeLabel,
              },
            ],
          }
        : {}),
      flavorLabel: presentation === "dub" ? "Dub" : "Sub",
      serverName: server.name,
      ...(player.subtitles.length > 0 ? { subtitleDelivery: "external" as const } : {}),
      confidence: 0.85,
      cachePolicy,
    };

    // Tracks need the same Origin as the segments; mpv sends the stream's
    // headers on subtitle requests too, so nothing per-track is attached.
    const subtitles: SubtitleCandidate[] = player.subtitles.map((track) => ({
      id: `subtitle:${KICKASSANIME_PROVIDER_ID}:${Bun.hash(track.src).toString(36)}`,
      providerId: KICKASSANIME_PROVIDER_ID,
      sourceId,
      url: track.src,
      language: normalizeIsoLanguageCode(track.language) ?? track.language,
      label: track.name,
      format: inferSubtitleFormat(track.src),
      source: "provider",
      confidence: 0.85,
      cachePolicy: { ...cachePolicy, ttlClass: "subtitle-list" },
    }));

    const selection = selectReadyStream([stream], {
      startupPriority: input.startupPriority,
      qualityPreference: input.qualityPreference,
      preferredStreamId: input.preferredStreamId,
      preferredSourceId: input.preferredSourceId,
      favoriteSourceNames: input.favoriteSourceNames,
    });
    const sources: ProviderSourceCandidate[] = [
      createSourceCandidateFromStream({
        providerId: KICKASSANIME_PROVIDER_ID,
        stream,
        label: `${server.name} · ${formatAnimeSourceDetail({
          audio: presentation,
          subtitleMode: subtitles.length > 0 ? "soft" : "unknown",
        })}`,
        selected: true,
        cachePolicy,
      }),
    ];
    const variants: ProviderVariantCandidate[] = [
      createVariantCandidateFromStream({ providerId: KICKASSANIME_PROVIDER_ID, stream, subtitles }),
    ];

    const resolved: ProviderResolveResult = {
      status: "resolved",
      providerId: KICKASSANIME_PROVIDER_ID,
      selectedStreamId: selection.selected.id,
      selectionDecision: selection.decision,
      sources,
      streams: [stream],
      variants,
      subtitles,
      failures: [],
      release: input.episode?.release,
      artwork: input.episode?.artwork,
      externalIds: {
        anilistId: input.title.externalIds?.anilistId ?? input.title.anilistId,
        providerNativeIds: { [KICKASSANIME_PROVIDER_ID]: slug },
      },
      cachePolicy,
      trace: createResolveTrace({
        title: input.title,
        episode: input.episode,
        providerId: KICKASSANIME_PROVIDER_ID,
        streamId: selection.selected.id,
        cacheHit: false,
        runtime: "direct-http",
        startedAt,
        endedAt: context.now(),
        events,
      }),
    };
    return resolved;
  },
};

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Test-only: the domain cache is process-wide. */
export const __testing = {
  reset(): void {
    currentBase = PRIMARY_BASE;
  },
};
