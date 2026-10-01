/**
 * AnimeKai HTTP client: browse search, watch-page catalog, sources, embed,
 * getSources, HLS ladder.
 *
 * `animekai.be` sits behind Cloudflare like hianime: metadata reads prefer the
 * injected fetch port (which carries the user-owned relay) and fall back to
 * local curl/curl-impersonate — the same shape as the HiAnime/AniDB clients.
 */

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { providerFetch, ProviderHttpError } from "../runtime/fetch";
import { expandHlsMasterInventory, isHlsDeadHostStatus } from "../shared/hls-ladder";
import { parseMegaplayEmbedSourceIds } from "../shared/megaplay-embed";
import { TTLCache } from "../shared/provider-cache";
import {
  providerCurlFailureMessage,
  providerFetchJson,
  providerFetchText,
  providerUrlLabel,
  runProviderCurlWithRetry,
  splitCurlHttpTrailer,
  type CurlHttpTrailer,
} from "../shared/provider-http-transport";
import { createTimeoutSignal } from "../shared/timeout-signal";
import {
  AnimekaiEmbedDecodeError,
  animekaiEmbedReferer,
  animekaiMasterUrlFromDecrypted,
  animekaiSourcesEndpoint,
  decryptAnimekaiSourcesBlob,
} from "./embed";
import { ANIMEKAI_PROVIDER_ID } from "./manifest";
import {
  parseAnimekaiEmbedDataId,
  animekaiMalIdFromEmbedUrl,
  ANIMEKAI_BASE,
  ANIMEKAI_REFERER,
  ANIMEKAI_USER_AGENT,
  animekaiFilterResultsByQueryWords,
  animekaiLongestWordFallback,
  chooseAnimekaiSearchMatch,
  looksLikeAnimekaiShowId,
  parseAnimekaiEpisodesHtml,
  parseAnimekaiSearchHtml,
  parseAnimekaiServersJson,
  parseAnimekaiSourcesJson,
  type AnimekaiAudioMode,
  type AnimekaiEpisodeEntry,
  type AnimekaiSearchResult,
  type AnimekaiServerEntry,
  type AnimekaiSourcesPayload,
} from "./parsers";

export {
  ANIMEKAI_BASE,
  ANIMEKAI_REFERER,
  ANIMEKAI_USER_AGENT,
  animekaiFilterResultsByQueryWords,
  animekaiLongestWordFallback,
  animekaiMalIdFromEmbedUrl,
  animekaiSourcesEndpoint,
  AnimekaiEmbedDecodeError,
  chooseAnimekaiSearchMatch,
  looksLikeAnimekaiShowId,
  parseAnimekaiEmbedDataId,
  parseAnimekaiEpisodesHtml,
  parseAnimekaiSearchHtml,
  parseAnimekaiServersJson,
  parseAnimekaiSourcesJson,
  type AnimekaiAudioMode,
  type AnimekaiEpisodeEntry,
  type AnimekaiSearchResult,
  type AnimekaiServerEntry,
  type AnimekaiSourcesPayload,
};

const EPISODE_CATALOG_MEMORY_TTL_MS = 1_800_000;
const EPISODE_CATALOG_PERSIST_TTL_MS = 2 * 60 * 60 * 1000;
const ANIMEKAI_EPISODES_CACHE_NAMESPACE = "animekai:episodes";

const episodeCache = new TTLCache<string, readonly AnimekaiEpisodeEntry[]>(
  EPISODE_CATALOG_MEMORY_TTL_MS,
  { maxEntries: 128 },
);

const showCache = new TTLCache<string, AnimekaiShow>(EPISODE_CATALOG_MEMORY_TTL_MS, {
  maxEntries: 256,
});

/** Test-only: drop module caches so fixtures control the read. */
export function clearAnimekaiCachesForTest(): void {
  episodeCache.clear();
  showCache.clear();
}

export type AnimekaiShow = {
  readonly id: string;
  readonly title: string;
};

export type AnimekaiStreamLink = {
  readonly url: string;
  readonly quality: string;
  readonly qualityRank: number;
  readonly referer: string;
};

export type AnimekaiStreamFailureCode =
  | "blocked"
  | "network-error"
  | "parse-failed"
  | "provider-unavailable"
  | "timeout"
  | "not-found";

/** What one embed lane produced, before its position in the mode is attached. */
export type AnimekaiResolvedLane = {
  readonly status: "resolved";
  readonly serverName: string;
  readonly links: readonly AnimekaiStreamLink[];
  readonly subtitles: AnimekaiSourcesPayload["tracks"];
  readonly malId?: string;
  readonly intro?: { readonly start: number; readonly end: number };
  readonly outro?: { readonly start: number; readonly end: number };
  readonly embedReferer: string;
  readonly ladderFallback?: boolean;
};

export type AnimekaiServerResolution =
  | (AnimekaiResolvedLane & { readonly serverIndex: number })
  | { readonly status: "failed"; readonly serverIndex: number; readonly serverName: string };

export type AnimekaiEpisodeStreamResolution = {
  /** Modes the sources endpoint listed at least one usable server for. */
  readonly availableModes: readonly AnimekaiAudioMode[];
  /** Every native server name the sources endpoint listed. */
  readonly observedServers: readonly string[];
  /** Modes the episode's watch-page flags advertise (data-sub/data-dub). */
  readonly advertisedModes: readonly AnimekaiAudioMode[];
  /** Servers offered per mode — the inventory row count, not the walked count. */
  readonly laneCounts: Readonly<Record<AnimekaiAudioMode, number>>;
  readonly requested: {
    readonly status: "resolved" | "unavailable" | "failed";
    readonly servers: readonly AnimekaiServerResolution[];
    readonly failure?: { readonly code: AnimekaiStreamFailureCode; readonly message: string };
  };
};

export { splitCurlHttpTrailer, type CurlHttpTrailer };

/** Back-compat name for the shared trailer splitter. */
export const splitAnimekaiCurlTrailer = splitCurlHttpTrailer;

/** Origin + path only — never the query, which can carry the user's title. */
export function animekaiUrlLabel(url: string): string {
  return providerUrlLabel(url);
}

export function animekaiCurlFailureMessage(
  stdout: string,
  stderr: string,
  exitCode: number,
  url?: string,
): string {
  return providerCurlFailureMessage(stdout, stderr, exitCode, {
    label: "animekai fetch",
    urlLabel: url ? providerUrlLabel(url) : undefined,
  });
}

export function animekaiCloudflareBlockMessage(impersonated: boolean): string {
  return impersonated
    ? "animekai blocked by Cloudflare (curl-impersonate was already used; retry later or from another network)"
    : "animekai blocked by Cloudflare (try curl-impersonate)";
}

export async function runAnimekaiCurlWithRetry(
  args: readonly string[],
  signal?: AbortSignal,
  url?: string,
): Promise<string> {
  return runProviderCurlWithRetry(args, {
    signal,
    urlLabel: url ? providerUrlLabel(url) : undefined,
    label: "animekai fetch",
    providerId: ANIMEKAI_PROVIDER_ID,
  });
}

/**
 * The relay→curl→fetch choreography lives in `shared/provider-http-transport`
 * now; animekai keeps its own wrapper only for its labels and messages —
 * relayed responses are final at every status (#460).
 */
export async function animekaiFetchText(
  url: string,
  options: {
    readonly context?: ProviderRuntimeContext;
    readonly signal?: AbortSignal;
    readonly maxTimeSec?: number;
    readonly referer?: string;
    readonly extraHeaders?: Record<string, string>;
  } = {},
): Promise<string> {
  return providerFetchText(url, {
    context: options.context,
    signal: options.signal,
    providerId: ANIMEKAI_PROVIDER_ID,
    label: "animekai fetch",
    userAgent: ANIMEKAI_USER_AGENT,
    referer: options.referer ?? ANIMEKAI_REFERER,
    extraHeaders: options.extraHeaders,
    maxTimeSec: options.maxTimeSec,
    blockedError: (impersonated) => new Error(animekaiCloudflareBlockMessage(impersonated)),
  });
}

async function animekaiFetchJson(
  url: string,
  options: Parameters<typeof animekaiFetchText>[1] = {},
): Promise<unknown> {
  return providerFetchJson(url, {
    context: options.context,
    signal: options.signal,
    providerId: ANIMEKAI_PROVIDER_ID,
    label: "animekai fetch",
    userAgent: ANIMEKAI_USER_AGENT,
    referer: options.referer ?? ANIMEKAI_REFERER,
    extraHeaders: options.extraHeaders,
    maxTimeSec: options.maxTimeSec,
    blockedError: (impersonated) => new Error(animekaiCloudflareBlockMessage(impersonated)),
    stage: "fetch-json",
  });
}

/**
 * The site matches the query as one literal phrase — "cyberpunk edgerunners"
 * misses "Cyberpunk: Edgerunners". ani-cli retries with the longest word and
 * keeps only results containing the others; that rescue lives here so both the
 * search capability and resolve's title bridge get it.
 */
export async function searchAnimekai(
  query: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<readonly AnimekaiSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const search = async (q: string) => {
    const page = await animekaiFetchText(
      `${ANIMEKAI_BASE}/browse?keyword=${encodeURIComponent(q).replace(/%20/g, "+")}&sort=most_viewed`,
      { signal, context },
    );
    return parseAnimekaiSearchHtml(page);
  };
  const results = await search(trimmed);
  if (results.length > 0) return results;
  const fallbackQuery = animekaiLongestWordFallback(trimmed);
  if (!fallbackQuery) return results;
  const widened = await search(fallbackQuery);
  return animekaiFilterResultsByQueryWords(widened, trimmed);
}

function directAnimekaiShowFromInput(title: ProviderResolveInput["title"]): AnimekaiShow | null {
  const native = title.externalIds?.providerNativeIds?.[ANIMEKAI_PROVIDER_ID];
  const id = looksLikeAnimekaiShowId(native)
    ? native
    : looksLikeAnimekaiShowId(title.id)
      ? title.id
      : null;
  if (!id) return null;
  return { id, title: title.title || id };
}

function normalizeAnimekaiShowQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function resolveAnimekaiShow(
  input: { readonly title: ProviderResolveInput["title"] },
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<AnimekaiShow | null> {
  const direct = directAnimekaiShowFromInput(input.title);
  if (direct) return direct;
  const query = input.title.title?.trim() ?? "";
  if (!query) return null;
  const key = normalizeAnimekaiShowQuery(query);
  const cached = key ? showCache.get(key) : undefined;
  if (cached) return cached;
  const match = chooseAnimekaiSearchMatch(query, await searchAnimekai(query, signal, context));
  if (match && key) showCache.set(key, { id: match.id, title: match.title });
  return match ? { id: match.id, title: match.title } : null;
}

export async function fetchAnimekaiEpisodeCatalog(
  showId: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<readonly AnimekaiEpisodeEntry[]> {
  const cached = episodeCache.get(showId);
  if (cached) return cached;

  const persistent = await context?.cache
    ?.read<readonly AnimekaiEpisodeEntry[]>(ANIMEKAI_EPISODES_CACHE_NAMESPACE, showId)
    .catch(() => null);
  if (persistent && persistent.length > 0) {
    episodeCache.set(showId, persistent);
    return persistent;
  }

  const raw = await animekaiFetchText(`${ANIMEKAI_BASE}/watch/${encodeURIComponent(showId)}`, {
    signal,
    context,
  });
  const entries = parseAnimekaiEpisodesHtml(raw, showId);
  // ani-cli guards this too: a watch page with zero `num=` anchors means the
  // markup moved, not that the show has no episodes — that is a parse failure,
  // not a catalog answer. A present-but-empty list is still impossible to
  // distinguish here, so surface it as not-found downstream.
  if (entries.length === 0) {
    throw new ProviderHttpError({
      message: `no episode list on the animekai watch page for ${showId} — site markup may have changed`,
      providerId: ANIMEKAI_PROVIDER_ID,
      stage: "parse-episodes",
      code: "parse-failed",
      retryable: false,
    });
  }
  episodeCache.set(showId, entries);
  // Fire-and-forget still needs a rejection handler — an unhandled rejection
  // escalates to a fatal shutdown in main.ts, so a cache-port failure degrades
  // to a no-op here, matching the anidb write.
  void Promise.resolve(
    context?.cache?.write(
      ANIMEKAI_EPISODES_CACHE_NAMESPACE,
      showId,
      entries,
      EPISODE_CATALOG_PERSIST_TTL_MS,
    ),
  ).catch(() => {});
  return entries;
}

export async function fetchAnimekaiServers(
  showId: string,
  episode: number,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<readonly AnimekaiServerEntry[]> {
  const json = await animekaiFetchJson(
    `${ANIMEKAI_BASE}/watch/${encodeURIComponent(showId)}/ep/${episode}/sources`,
    { signal, context },
  );
  return parseAnimekaiServersJson(json);
}

function failureOf(error: unknown): { code: AnimekaiStreamFailureCode; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof AnimekaiEmbedDecodeError) {
    return { code: "parse-failed", message: `animekai embed decode failed: ${error.code}` };
  }
  if (error instanceof ProviderHttpError) {
    const status = error.status;
    if (status === 404 || status === 410 || error.code === "not-found") {
      return { code: "not-found", message };
    }
    if (error.code === "parse-failed") return { code: "parse-failed", message };
    if (
      status === 401 ||
      status === 403 ||
      error.code === "blocked" ||
      error.code === "rate-limited"
    ) {
      return { code: "blocked", message };
    }
    if (error.code === "timeout") return { code: "timeout", message };
    if (error.code === "provider-unavailable" || (status !== undefined && status >= 500)) {
      return { code: "provider-unavailable", message };
    }
    return { code: "network-error", message };
  }
  if (/animekai fetch HTTP (404|410)\b/.test(message)) return { code: "not-found", message };
  if (/cloudflare|just a moment/i.test(message)) return { code: "blocked", message };
  return { code: "network-error", message };
}

/**
 * One server lane: embed page (animekai.be referer) → `data-id` →
 * getSources (XMLHttpRequest) → AES blob → master m3u8 → ladder expansion.
 * The playlist and subtitles take the embed origin as referer.
 */
async function resolveAnimekaiServer(
  server: AnimekaiServerEntry,
  context: ProviderRuntimeContext,
  signal?: AbortSignal,
): Promise<AnimekaiResolvedLane> {
  const embedHtml = await animekaiFetchText(server.embedUrl, {
    signal,
    context,
    referer: ANIMEKAI_REFERER,
  });
  // Dual-id deployments key getSources on `data-mediaid` while `data-id`
  // decrypts to an empty payload — walk every advertised id and let the
  // decrypt decide which one is real.
  const sourceIds = parseMegaplayEmbedSourceIds(embedHtml);
  if (sourceIds.length === 0) {
    throw new AnimekaiEmbedDecodeError(
      "missing-data-id",
      "animekai embed page exposes no player data-id",
    );
  }
  const embedReferer = animekaiEmbedReferer(server.embedUrl);
  let payload: AnimekaiSourcesPayload | undefined;
  let masterUrl: string | undefined;
  let lastError: unknown;
  for (const sourceId of sourceIds) {
    try {
      const sourcesJson = await animekaiFetchJson(
        animekaiSourcesEndpoint(server.embedUrl, sourceId),
        {
          signal,
          context,
          referer: embedReferer,
          extraHeaders: { "X-Requested-With": "XMLHttpRequest" },
        },
      );
      const parsed = parseAnimekaiSourcesJson(sourcesJson);
      if (!parsed) {
        throw new AnimekaiEmbedDecodeError(
          "missing-playlist",
          "animekai getSources payload carries no enc blob",
        );
      }
      masterUrl = animekaiMasterUrlFromDecrypted(await decryptAnimekaiSourcesBlob(parsed.enc));
      payload = parsed;
      break;
    } catch (error) {
      if (signal?.aborted === true) throw error;
      lastError = error;
    }
  }
  if (!payload || masterUrl === undefined) {
    throw lastError instanceof Error
      ? lastError
      : new AnimekaiEmbedDecodeError("decrypt-failed", "animekai getSources answered non-JSON");
  }
  const ladderHeaders = {
    "User-Agent": ANIMEKAI_USER_AGENT,
    Referer: embedReferer,
    Origin: embedReferer.replace(/\/$/, ""),
  };
  const fetchImpl = (url: string, init?: RequestInit) => providerFetch(context, url, init);
  const inventory = await expandHlsMasterInventory({
    fetch: fetchImpl,
    masterUrl,
    headers: ladderHeaders,
    signal: createTimeoutSignal(signal, 15_000),
  });
  // A dead master host makes the `auto` fallback row a corpse — drop it.
  // 403/timeout stays: gatekept CDNs still play in mpv.
  const variants = isHlsDeadHostStatus(inventory.probe.httpStatus) ? [] : inventory.variants;
  const links: AnimekaiStreamLink[] = variants.map((variant) => ({
    url: variant.url,
    quality: variant.qualityLabel,
    qualityRank: variant.qualityRank,
    referer: embedReferer,
  }));
  if (links.length === 0) {
    const deadHostStatus = isHlsDeadHostStatus(inventory.probe.httpStatus)
      ? inventory.probe.httpStatus
      : undefined;
    throw new ProviderHttpError({
      message:
        deadHostStatus !== undefined
          ? `animekai master host answered HTTP ${deadHostStatus} — dead upstream`
          : "animekai ladder expansion returned no variants",
      providerId: ANIMEKAI_PROVIDER_ID,
      stage: "ladder",
      code:
        deadHostStatus !== undefined
          ? deadHostStatus >= 500
            ? "provider-unavailable"
            : "not-found"
          : "network-error",
      retryable: deadHostStatus !== undefined ? deadHostStatus >= 500 : true,
      ...(deadHostStatus !== undefined && { status: deadHostStatus }),
    });
  }
  const malId = animekaiMalIdFromEmbedUrl(server.embedUrl);
  const ladderFallback =
    links.length === 1 &&
    links[0]?.url === masterUrl &&
    links[0]?.quality === "auto" &&
    links[0]?.qualityRank === 0;
  return {
    status: "resolved",
    serverName: server.serverName,
    links,
    subtitles: payload.tracks,
    ...(malId && { malId }),
    ...(payload.intro && { intro: payload.intro }),
    ...(payload.outro && { outro: payload.outro }),
    embedReferer,
    ...(ladderFallback && { ladderFallback: true as const }),
  };
}

/**
 * Walk the mode's server list in order — the sources endpoint lists several
 * embeds per mode and a dead lane must not take the episode with it (that is
 * the in-provider multi-server fallback ani-cli does not have).
 */
export async function resolveAnimekaiEpisodeStreams({
  context,
  showId,
  episode,
  requestedMode,
  entry,
  onlyServerIndex,
  signal,
}: {
  readonly context: ProviderRuntimeContext;
  readonly showId: string;
  readonly episode: number;
  readonly requestedMode: AnimekaiAudioMode;
  readonly entry?: AnimekaiEpisodeEntry;
  /** A pinned source row (`source:animekai:<mode>:<n>`) resolves only that lane. */
  readonly onlyServerIndex?: number;
  readonly signal?: AbortSignal;
}): Promise<AnimekaiEpisodeStreamResolution> {
  const advertisedModes = (["sub", "dub"] as const).filter((mode) =>
    mode === "sub" ? entry?.sub : entry?.dub,
  );

  let servers: readonly AnimekaiServerEntry[];
  try {
    servers = await fetchAnimekaiServers(showId, episode, signal, context);
  } catch (error) {
    if (signal?.aborted === true) throw error;
    return {
      availableModes: [],
      observedServers: [],
      advertisedModes,
      laneCounts: { sub: 0, dub: 0 },
      requested: { status: "failed", servers: [], failure: failureOf(error) },
    };
  }
  const observedServers = [...new Set(servers.map((server) => server.serverName))];
  const availableModes = (["sub", "dub"] as const).filter((mode) =>
    servers.some((server) => server.audioMode === mode),
  );
  const laneCounts: Record<AnimekaiAudioMode, number> = { sub: 0, dub: 0 };
  for (const server of servers) laneCounts[server.audioMode] += 1;

  const modeServers = servers.filter((server) => server.audioMode === requestedMode);
  const lanes =
    onlyServerIndex === undefined
      ? modeServers
      : modeServers.filter((_, index) => index === onlyServerIndex);
  if (lanes.length === 0) {
    return {
      availableModes,
      observedServers,
      advertisedModes,
      laneCounts,
      requested: { status: "unavailable", servers: [] },
    };
  }

  const resolved: AnimekaiServerResolution[] = [];
  let firstFailure: { code: AnimekaiStreamFailureCode; message: string } | undefined;
  for (const server of lanes) {
    // Mode-local index keeps the source row stable regardless of how sub and
    // dub entries interleave in the endpoint's array.
    const index = modeServers.indexOf(server);
    try {
      const resolution = await resolveAnimekaiServer(server, context, signal);
      resolved.push({ ...resolution, serverIndex: index });
      // One playable lane is enough — further servers only cost requests.
      break;
    } catch (error) {
      if (signal?.aborted === true) throw error;
      firstFailure ??= failureOf(error);
      resolved.push({ status: "failed", serverIndex: index, serverName: server.serverName });
    }
  }

  const ok = resolved.find((server) => server.status === "resolved");
  return {
    availableModes,
    observedServers,
    advertisedModes,
    laneCounts,
    requested: ok
      ? { status: "resolved", servers: resolved }
      : {
          status: "failed",
          servers: resolved,
          ...(firstFailure && { failure: firstFailure }),
        },
  };
}
