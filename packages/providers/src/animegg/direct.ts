/**
 * AnimeGG — the anime lane's independent second source.
 *
 * Its value is what it does not share with Miruro. Miruro reaches AnimeGG too,
 * as its `moo` server, but only through `miruro.bz`, so it goes dark when Miruro
 * does. This adapter has its own catalog, its own site and its own CDN, and
 * needs neither AniList nor AniDB — both of which were down on 2026-09-11.
 *
 * Four plain HTML documents, no JavaScript step and no crypto. Parsing lives in
 * `site.ts`; this file is the runtime contract around it.
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
  TitleIdentity,
} from "@kunai/types";

import { resolveAnimeAudioIntent } from "../shared/anime-audio-intent";
import {
  animeQualityFields,
  formatAnimeSourceArchetype,
  formatAnimeSourceDetail,
} from "../shared/anime-source-presentation";
import { directStreamFetchSignal } from "../shared/direct-stream-source";
import { selectProviderEpisodeNumber } from "../shared/provider-episode-number";
import { matchProviderCatalogTitle } from "../shared/provider-title-match";
import { createExhaustedResult, emitTraceEvent } from "../shared/resolve-helpers";
import {
  createSourceCandidateFromStream,
  createStreamId,
  createVariantCandidateFromStream,
} from "../shared/source-inventory";
import { selectReadyStream } from "../shared/startup-selection";
import { animeggManifest, ANIMEGG_PROVIDER_ID } from "./manifest";
import {
  animeggEmbedPath,
  animeggEpisodePath,
  animeggSearchPath,
  animeggSeriesPath,
  animeggStreamUrl,
  parseAnimeggEmbedSources,
  parseAnimeggEpisodeNumbers,
  parseAnimeggEpisodeTabs,
  parseAnimeggSearchResults,
  type AnimeggEpisodeTab,
} from "./site";

export { ANIMEGG_PROVIDER_ID };

const ANIMEGG_FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * The site needs no referer and no cookie, on any of its four documents or on
 * the stream itself (verified 2026-09-11). Sending only what is required keeps
 * the mpv handoff identical to what was tested.
 */
function requestHeaders(): Record<string, string> {
  return {
    accept: "text/html,application/xhtml+xml",
    "accept-language": "en-US,en;q=0.9",
    "user-agent": USER_AGENT,
  };
}

async function fetchText(
  url: string,
  context: ProviderRuntimeContext,
  signal?: AbortSignal,
): Promise<string> {
  const requester = context.fetch?.fetch.bind(context.fetch) ?? fetch;
  const response = await requester(url, {
    headers: requestHeaders(),
    signal: directStreamFetchSignal(signal ?? context.signal, ANIMEGG_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`AnimeGG returned HTTP ${response.status}`);
  return response.text();
}

/**
 * The AnimeGG slug a title already carries, from the provider-native id its own
 * search stored. `title.id` is deliberately not a fallback: an AnimeGG slug is
 * plain lowercase kebab (`one-piece`) with nothing to tell it apart from
 * another catalog's slug of the same shape, so trusting it would let a
 * same-named page play as though it were this show. A title from elsewhere is
 * matched by name instead, in `locateAnimeggShow`.
 */
export function resolveAnimeggSlug(title: TitleIdentity): string | null {
  const native = title.externalIds?.providerNativeIds?.[ANIMEGG_PROVIDER_ID]?.trim();
  if (!native) return null;
  return /^[a-z0-9][a-z0-9-]*$/.test(native) ? native : null;
}

/**
 * The show for a title found in any catalog. AnimeGG is a fallback, so the
 * titles reaching it usually came from Miruro or AniList and carry no slug;
 * without this the provider could only ever play what its own search found.
 *
 * The search page is the only name index the site has, and it exposes no year,
 * so the match is on name alone and must be unique — including the alt titles
 * both sides list, which is what connects "Sousou no Frieren" to
 * "Frieren: Beyond Journey's End". The answer is remembered against the AniList
 * id so later episodes cost nothing.
 */
export async function locateAnimeggShow(
  title: TitleIdentity,
  context: ProviderRuntimeContext,
  events?: ProviderTraceEvent[],
): Promise<string | null> {
  const own = resolveAnimeggSlug(title);
  if (own) return own;

  const anilistId = title.externalIds?.anilistId ?? title.anilistId;
  const bridgeKey = anilistId
    ? { providerId: ANIMEGG_PROVIDER_ID, catalogKind: "anime" as const, catalogId: anilistId }
    : undefined;
  const remembered = bridgeKey ? context.titleBridge?.get(bridgeKey) : undefined;
  if (remembered) return remembered;

  const query = title.title.trim();
  if (!query) return null;
  const rows = parseAnimeggSearchResults(await fetchText(animeggSearchPath(query), context));
  const match = matchProviderCatalogTitle(rows, { title: query });
  if (!match) return null;

  if (bridgeKey) context.titleBridge?.set({ ...bridgeKey, nativeId: match.slug });
  if (events) {
    emitTraceEvent(events, context, {
      type: "source:success",
      providerId: ANIMEGG_PROVIDER_ID,
      sourceId: `source:${ANIMEGG_PROVIDER_ID}:title-match`,
      message: `Matched "${title.title}" to AnimeGG ${match.slug} by name`,
      attributes: { slug: match.slug },
    });
  }
  return match.slug;
}

/**
 * Pick the tab for the requested audio, and say when it had to fall back.
 * Returning the fallback silently would play Japanese audio to someone who asked
 * for a dub and leave nothing in the trace to explain it.
 */
export function selectAnimeggTab(
  tabs: readonly AnimeggEpisodeTab[],
  wanted: "sub" | "dub",
): { readonly tab: AnimeggEpisodeTab; readonly fellBack: boolean } | null {
  const version = wanted === "dub" ? "dubbed" : "subbed";
  const exact = tabs.find((tab) => tab.version === version);
  if (exact) return { tab: exact, fellBack: false };
  const other = tabs[0];
  return other ? { tab: other, fellBack: true } : null;
}

export const animeggProviderModule: CoreProviderModule = {
  providerId: ANIMEGG_PROVIDER_ID,
  manifest: animeggManifest,

  async search(input, context) {
    const query = input.query.trim();
    if (!query) return null;
    const html = await fetchText(animeggSearchPath(query), context);
    const results = parseAnimeggSearchResults(html).slice(0, 40);
    if (results.length === 0) return null;

    return results.map((result): ProviderSearchResult => {
      // Every AnimeGG entry is a series page, even one-episode films; the
      // catalog exposes no film flag, so nothing here may claim one.
      return {
        id: result.slug,
        type: "series",
        title: result.title,
        metadataSource: "AnimeGG",
        posterPath: result.posterUrl ?? null,
        ...(result.posterUrl
          ? { artwork: { posterUrl: result.posterUrl, thumbnailUrl: result.posterUrl } }
          : {}),
        ...(result.episodeCount ? { episodeCount: result.episodeCount } : {}),
        ...(result.altNames.length > 0 ? { altNames: result.altNames } : {}),
        externalIds: { providerNativeIds: { [ANIMEGG_PROVIDER_ID]: result.slug } },
      };
    });
  },

  async listEpisodes(input, context) {
    const slug = await locateAnimeggShow(input.title, context);
    if (!slug) return null;
    const html = await fetchText(animeggSeriesPath(slug), context);
    const numbers = parseAnimeggEpisodeNumbers(html, slug);
    if (numbers.length === 0) return null;

    return numbers.map(
      (episode): ProviderEpisodeOption => ({
        index: episode,
        label: `Episode ${episode}`,
        totalEpisodeCount: numbers.length,
        externalIds: { providerNativeIds: { [ANIMEGG_PROVIDER_ID]: slug } },
      }),
    );
  },

  async resolve(input, context) {
    const startedAt = context.now();
    const events: ProviderTraceEvent[] = [];
    const cachePolicy: CachePolicy = animeggManifest.cachePolicy;

    const fail = (
      code: Parameters<typeof createExhaustedResult>[3]["code"],
      message: string,
      retryable = false,
    ) =>
      createExhaustedResult(
        input,
        context,
        ANIMEGG_PROVIDER_ID,
        { code, message, retryable },
        { cachePolicy, events, startedAt },
      );

    if (input.mediaKind !== "anime") {
      return fail("unsupported-title", "AnimeGG only supports anime");
    }
    let slug: string | null;
    try {
      slug = await locateAnimeggShow(input.title, context, events);
    } catch (error) {
      return fail("network-error", `AnimeGG search failed: ${describe(error)}`, true);
    }
    if (!slug) {
      return fail("not-found", `AnimeGG has no show that is clearly "${input.title.title}"`);
    }

    const episode = selectProviderEpisodeNumber(input.episode);
    const audio = resolveAnimeAudioIntent(input.preferredAudioLanguage ?? "original");
    const episodeUrl = animeggEpisodePath(slug, episode);

    let tabs: readonly AnimeggEpisodeTab[];
    try {
      tabs = parseAnimeggEpisodeTabs(await fetchText(episodeUrl, context));
    } catch (error) {
      return fail("network-error", `AnimeGG episode page failed: ${describe(error)}`, true);
    }
    const picked = selectAnimeggTab(tabs, audio.catalogMode);
    if (!picked) {
      return fail("not-found", `AnimeGG has no player for ${slug} episode ${episode}`);
    }
    if (picked.fellBack) {
      emitTraceEvent(events, context, {
        type: "audio:fallback",
        providerId: ANIMEGG_PROVIDER_ID,
        message: `AnimeGG has no ${audio.catalogMode} for episode ${episode}; playing ${picked.tab.version}`,
      });
    }

    const presentation = picked.tab.version === "dubbed" ? "dub" : "sub";
    let sources: ReturnType<typeof parseAnimeggEmbedSources>;
    try {
      sources = parseAnimeggEmbedSources(
        await fetchText(animeggEmbedPath(picked.tab.embedId), context),
      );
    } catch (error) {
      return fail("network-error", `AnimeGG embed failed: ${describe(error)}`, true);
    }

    const sourceId = `source:${ANIMEGG_PROVIDER_ID}:${picked.tab.mirror.toLowerCase()}:${presentation}`;
    const streams: StreamCandidate[] = [];
    for (const source of sources) {
      const url = animeggStreamUrl(source.file);
      if (!url) continue;
      const quality = animeQualityFields(source.label);
      streams.push({
        id: createStreamId(ANIMEGG_PROVIDER_ID, [slug, episode, presentation, source.file]),
        providerId: ANIMEGG_PROVIDER_ID,
        sourceId,
        url,
        protocol: "mp4",
        container: "mp4",
        // The CDN behind the /play redirect refuses a request with no referer
        // ("bad hand off"): mpv writes no frame without this, and one frame with
        // it. animegg.org itself 302s either way, so only the player sees this.
        headers: { referer: episodeUrl, "user-agent": USER_AGENT },
        qualityLabel: quality.qualityLabel,
        qualityRank: quality.qualityRank,
        presentation,
        audioLanguages: presentation === "dub" ? ["en"] : ["ja"],
        flavorLabel: presentation === "dub" ? "Dub" : "Sub",
        flavorArchetype: formatAnimeSourceArchetype({
          audio: presentation,
          detail: presentation === "dub" ? "Dub" : "Sub",
        }),
        serverName: picked.tab.mirror,
        // The subbed version burns English into the picture; there is no track
        // to offer, and claiming one would put a second set of subtitles on it.
        ...(presentation === "sub"
          ? { subtitleDelivery: "hardcoded" as const, hardSubLanguage: "en" }
          : {}),
        confidence: 0.9,
        cachePolicy,
        languageEvidence: [
          {
            role: "audio",
            normalizedLanguage: presentation === "dub" ? "en" : "ja",
            nativeLabel: picked.tab.version,
            sourceId,
            confidence: 0.85,
          },
        ],
      });
    }

    if (streams.length === 0) {
      return fail("not-found", `AnimeGG embed listed no playable file for ${slug} ${episode}`);
    }

    const selection = selectReadyStream(streams, {
      startupPriority: input.startupPriority,
      qualityPreference: input.qualityPreference,
      preferredStreamId: input.preferredStreamId,
      preferredSourceId: input.preferredSourceId,
      favoriteSourceNames: input.favoriteSourceNames,
    });

    const inventory: ProviderSourceCandidate[] = [
      createSourceCandidateFromStream({
        providerId: ANIMEGG_PROVIDER_ID,
        stream: selection.selected,
        label: `${picked.tab.mirror} · ${formatAnimeSourceDetail({
          audio: presentation,
          subtitleMode: presentation === "sub" ? "hard" : "unknown",
        })}`,
        selected: true,
        cachePolicy,
      }),
    ];
    const variants: ProviderVariantCandidate[] = streams.map((stream) =>
      createVariantCandidateFromStream({ providerId: ANIMEGG_PROVIDER_ID, stream }),
    );

    const resolved: ProviderResolveResult = {
      status: "resolved",
      providerId: ANIMEGG_PROVIDER_ID,
      selectedStreamId: selection.selected.id,
      selectionDecision: selection.decision,
      sources: inventory,
      streams,
      variants,
      subtitles: [],
      failures: [],
      release: input.episode?.release,
      artwork: input.episode?.artwork,
      externalIds: {
        anilistId: input.title.externalIds?.anilistId ?? input.title.anilistId,
        providerNativeIds: { [ANIMEGG_PROVIDER_ID]: slug },
      },
      cachePolicy,
      trace: createResolveTrace({
        title: input.title,
        episode: input.episode,
        providerId: ANIMEGG_PROVIDER_ID,
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
