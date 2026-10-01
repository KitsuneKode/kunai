/**
 * HiAnime HTTP client: search, episode catalog, servers, embed, HLS ladder.
 *
 * `hianime.at` HTML/JSON usually answers plain fetch, but the whole lane sits
 * behind Cloudflare, so metadata reads prefer the injected fetch port (which
 * carries the user-owned relay when configured) and fall back to local
 * curl/curl-impersonate — the same shape as the AniDB client.
 */

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { providerFetch, ProviderHttpError } from "../runtime/fetch";
import { expandHlsMasterInventory, isHlsDeadHostStatus } from "../shared/hls-ladder";
import {
  decryptMegaplaySourcesBlob,
  MegaplayEmbedDecodeError,
  megaplayEmbedReferer,
  megaplayMasterUrlFromDecrypted,
  megaplaySourcesEndpoint,
  type MegaplaySourcesPayload,
  parseMegaplayEmbedSourceIds,
  parseMegaplaySourcesJson,
} from "../shared/megaplay-embed";
import { TTLCache } from "../shared/provider-cache";
import {
  providerCurlFailureMessage,
  providerFetchText,
  providerUrlLabel,
  runProviderCurlWithRetry,
  splitCurlHttpTrailer,
  type CurlHttpTrailer,
} from "../shared/provider-http-transport";
import { createTimeoutSignal } from "../shared/timeout-signal";
import {
  decodeHianimeEmbedPage,
  hianimeEmbedReferer,
  hianimeMalIdFromEmbedUrl,
  HianimeEmbedDecodeError,
  type HianimeEmbedPayload,
} from "./embed";
import { HIANIME_PROVIDER_ID, HIANIME_SUPPORTED_SERVER } from "./manifest";
import {
  chooseHianimeSearchMatch,
  HIANIME_BASE,
  HIANIME_REFERER,
  HIANIME_USER_AGENT,
  hianimeNumericId,
  looksLikeHianimeShowId,
  parseHianimeEpisodesHtml,
  parseHianimeSearchHtml,
  parseHianimeServersHtml,
  type HianimeAudioMode,
  type HianimeEpisodeEntry,
  type HianimeSearchResult,
  type HianimeServerEntry,
} from "./parsers";

export {
  HIANIME_SUPPORTED_SERVER,
  hianimeNumericId,
  looksLikeHianimeShowId,
  parseHianimeEpisodesHtml,
  parseHianimeSearchHtml,
  parseHianimeServersHtml,
  chooseHianimeSearchMatch,
  decodeHianimeEmbedPage,
  hianimeEmbedReferer,
  hianimeMalIdFromEmbedUrl,
  HianimeEmbedDecodeError,
  type HianimeAudioMode,
  type HianimeEpisodeEntry,
  type HianimeSearchResult,
  type HianimeServerEntry,
  type HianimeEmbedPayload,
};

const EPISODE_CATALOG_MEMORY_TTL_MS = 1_800_000;
const EPISODE_CATALOG_PERSIST_TTL_MS = 2 * 60 * 60 * 1000;
const HIANIME_EPISODES_CACHE_NAMESPACE = "hianime:episodes";

const episodeCache = new TTLCache<string, readonly HianimeEpisodeEntry[]>(
  EPISODE_CATALOG_MEMORY_TTL_MS,
  { maxEntries: 128 },
);

/** Title-query → show slug. Same memory TTL as the episode catalog: repeat
 * title-identity resolves (browse lists, post-play) skip a /search round
 * trip while native-id resolves bypass the cache entirely (no network). */
const showCache = new TTLCache<string, HianimeShow>(EPISODE_CATALOG_MEMORY_TTL_MS, {
  maxEntries: 256,
});

/** Test-only: drop the module episode catalog so fixtures control the read. */
export function clearHianimeCachesForTest(): void {
  episodeCache.clear();
  showCache.clear();
}

export type HianimeShow = {
  readonly id: string;
  readonly title: string;
};

export type HianimeStreamLink = {
  readonly url: string;
  readonly quality: string;
  readonly qualityRank: number;
  readonly referer: string;
};

/** What one server lane produced, before its position in the mode is attached. */
export type HianimeResolvedLane = {
  readonly status: "resolved";
  readonly serverName: string;
  readonly serverKind: HianimeServerKind;
  readonly links: readonly HianimeStreamLink[];
  readonly subtitles: HianimeEmbedPayload["subtitles"];
  readonly malId?: string;
  readonly intro?: { readonly start: number; readonly end: number };
  readonly outro?: { readonly start: number; readonly end: number };
  /** Episode poster and scrub-preview sprite, when the embed provides them. */
  readonly poster?: string;
  readonly spriteVtt?: string;
  readonly embedReferer: string;
  /** True when the ladder collapsed to the single `auto` fallback row. */
  readonly ladderFallback?: boolean;
};

export type HianimeServerResolution =
  | (HianimeResolvedLane & { readonly serverIndex: number })
  | {
      readonly status: "failed";
      readonly serverIndex: number;
      readonly serverName: string;
      readonly failure: {
        readonly code: HianimeStreamFailureCode;
        readonly message: string;
      };
    };

export type HianimeModeResolution = {
  readonly mode: HianimeAudioMode;
  readonly status: "resolved" | "unavailable" | "failed";
  readonly servers: readonly HianimeServerResolution[];
  readonly failure?: {
    readonly code: HianimeStreamFailureCode;
    readonly message: string;
  };
};

export type HianimeEpisodeStreamResolution = {
  /** Modes with at least one supported server for this episode. */
  readonly availableModes: readonly HianimeAudioMode[];
  /** Every native server name the servers API listed (supported or not). */
  readonly observedServers: readonly string[];
  /**
   * Supported servers offered per mode, in API order — names double as the
   * inventory row labels; `laneNames[mode].length` is the lane count.
   */
  readonly laneNames: Readonly<Record<HianimeAudioMode, readonly string[]>>;
  readonly requested: HianimeModeResolution;
};

export { splitCurlHttpTrailer, type CurlHttpTrailer };

/**
 * The request label for error messages: origin + path, never the query —
 * `/search?keyword=…` would otherwise write the user's title query into an
 * error that lands in logs.txt.
 */
export function hianimeUrlLabel(url: string): string {
  return providerUrlLabel(url);
}

/** Name the failed layer first: transport (`no HTTP response`) or HTTP status. */
export function hianimeCurlFailureMessage(
  stdout: string,
  stderr: string,
  exitCode: number,
  url?: string,
): string {
  return providerCurlFailureMessage(stdout, stderr, exitCode, {
    label: "hianime fetch",
    urlLabel: url ? providerUrlLabel(url) : undefined,
  });
}

/** The advice depends on the binary that just ran — telling a user to "try
 * curl-impersonate" when the impersonating wrapper is what Cloudflare just
 * refused sends them chasing a tool they already have. */
export function cloudflareBlockMessage(impersonated: boolean): string {
  return impersonated
    ? "hianime blocked by Cloudflare (curl-impersonate was already used; retry later or from another network)"
    : "hianime blocked by Cloudflare (try curl-impersonate)";
}

export async function runHianimeCurlWithRetry(
  args: readonly string[],
  signal?: AbortSignal,
  url?: string,
): Promise<string> {
  return runProviderCurlWithRetry(args, {
    signal,
    urlLabel: url ? providerUrlLabel(url) : undefined,
    label: "hianime fetch",
    providerId: HIANIME_PROVIDER_ID,
  });
}

/**
 * The relay→curl→fetch choreography lives in `shared/provider-http-transport`
 * now; hianime keeps its own wrapper only for its labels and messages. Relayed
 * responses are final (all statuses), unmarked non-OK earns curl's
 * fingerprint, and challenge text maps to {@link cloudflareBlockMessage}.
 */
export async function hianimeFetchText(
  url: string,
  options: {
    readonly context?: ProviderRuntimeContext;
    readonly signal?: AbortSignal;
    readonly maxTimeSec?: number;
    readonly referer?: string;
    /** Per-request headers beyond UA/Referer (e.g. the megaplay sources XHR). */
    readonly extraHeaders?: Readonly<Record<string, string>>;
  } = {},
): Promise<string> {
  return providerFetchText(url, {
    context: options.context,
    signal: options.signal,
    providerId: HIANIME_PROVIDER_ID,
    label: "hianime fetch",
    userAgent: HIANIME_USER_AGENT,
    referer: options.referer ?? HIANIME_REFERER,
    extraHeaders: options.extraHeaders,
    maxTimeSec: options.maxTimeSec,
    blockedError: (impersonated) => new Error(cloudflareBlockMessage(impersonated)),
  });
}

export async function searchHianime(
  query: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<readonly HianimeSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const page = await hianimeFetchText(
    `${HIANIME_BASE}/search?keyword=${encodeURIComponent(trimmed).replace(/%20/g, "+")}`,
    { signal, context },
  );
  return parseHianimeSearchHtml(page);
}

function directHianimeShowFromInput(title: ProviderResolveInput["title"]): HianimeShow | null {
  const native = title.externalIds?.providerNativeIds?.["hianime"];
  const id = looksLikeHianimeShowId(native)
    ? native
    : looksLikeHianimeShowId(title.id)
      ? title.id
      : null;
  if (!id) return null;
  return { id, title: title.title || id };
}

/** Cache key mirrors the match normalization in parsers: queries that match
 * the same title share one slug. */
function normalizeHianimeShowQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function resolveHianimeShow(
  input: { readonly title: ProviderResolveInput["title"] },
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<HianimeShow | null> {
  const direct = directHianimeShowFromInput(input.title);
  if (direct) return direct;
  const query = input.title.title?.trim() ?? "";
  if (!query) return null;
  const key = normalizeHianimeShowQuery(query);
  const cached = key ? showCache.get(key) : undefined;
  if (cached) return cached;
  const match = chooseHianimeSearchMatch(query, await searchHianime(query, signal, context));
  // Cache hits only: a transient empty search must not poison later resolves,
  // mirroring the episode catalog's never-cache-empty rule.
  if (match && key) showCache.set(key, match);
  return match;
}

export async function fetchHianimeEpisodeCatalog(
  showId: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<readonly HianimeEpisodeEntry[]> {
  const cached = episodeCache.get(showId);
  if (cached) return cached;

  const persistent = await context?.cache
    ?.read<readonly HianimeEpisodeEntry[]>(HIANIME_EPISODES_CACHE_NAMESPACE, showId)
    .catch(() => null);
  if (persistent && persistent.length > 0) {
    episodeCache.set(showId, persistent);
    return persistent;
  }

  const numeric = hianimeNumericId(showId);
  if (numeric === null) return [];
  const raw = await hianimeFetchText(`${HIANIME_BASE}/api/theme/episode/list/${numeric}`, {
    signal,
    context,
  });
  let html: string;
  try {
    html = (JSON.parse(raw) as { html?: unknown }).html as string;
    if (typeof html !== "string") return [];
  } catch {
    throw new Error("hianime episode catalog parse failed");
  }
  const entries = parseHianimeEpisodesHtml(html, showId);
  if (entries.length === 0) return [];
  episodeCache.set(showId, entries);
  void context?.cache?.write(
    HIANIME_EPISODES_CACHE_NAMESPACE,
    showId,
    entries,
    EPISODE_CATALOG_PERSIST_TTL_MS,
  );
  return entries;
}

export async function fetchHianimeServers(
  episodeId: string,
  signal?: AbortSignal,
  context?: ProviderRuntimeContext,
): Promise<readonly HianimeServerEntry[]> {
  const raw = await hianimeFetchText(
    `${HIANIME_BASE}/api/theme/episode/servers?episodeId=${encodeURIComponent(episodeId)}`,
    { signal, context },
  );
  let html: string;
  try {
    html = (JSON.parse(raw) as { html?: unknown }).html as string;
    if (typeof html !== "string") return [];
  } catch {
    throw new Error("hianime servers response parse failed");
  }
  return parseHianimeServersHtml(html);
}

export type HianimeServerKind = "zokoanime" | "megaplay";

/** Server names observed on megaplay-family embeds; the host decides first. */
const MEGAPLAY_SERVER_NAMES = ["HD-1", "Vidstream-2"] as const;

function hianimeHost(embedUrl: string): string | null {
  try {
    return new URL(embedUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Which extraction contract a server entry answers to. The embed host is the
 * evidence (megaplay.buzz and TLD rotations speak the data-id/getSources
 * contract); the advertised name is the fallback for a domain the list has
 * not caught yet. VidPlay-1's vidtube.site player matches neither.
 */
export function hianimeServerKind(server: HianimeServerEntry): HianimeServerKind | null {
  const host = hianimeHost(server.embedUrl);
  if (host?.startsWith("zokoanime.")) return "zokoanime";
  if (host?.startsWith("megaplay.")) return "megaplay";
  const byName = (name: string) =>
    server.serverName.localeCompare(name, undefined, { sensitivity: "accent" }) === 0;
  if (byName(HIANIME_SUPPORTED_SERVER)) return "zokoanime";
  if (MEGAPLAY_SERVER_NAMES.some(byName)) return "megaplay";
  return null;
}

export type HianimeStreamFailureCode =
  | "blocked"
  | "network-error"
  | "parse-failed"
  | "provider-unavailable"
  | "timeout"
  | "not-found";

type HianimeStreamFailure = {
  readonly code: HianimeStreamFailureCode;
  readonly message: string;
};

function failureOf(error: unknown): HianimeStreamFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof HianimeEmbedDecodeError) {
    return { code: "parse-failed", message: `hianime embed decode failed: ${error.code}` };
  }
  if (error instanceof MegaplayEmbedDecodeError) {
    return { code: "parse-failed", message: `megaplay sources decode failed: ${error.code}` };
  }
  // Typed upstream failures keep their status fidelity — the ladder fetch and
  // other typed throws must not collapse into a generic network-error, or a
  // 404 reads identical to a refused connection.
  if (error instanceof ProviderHttpError) {
    const status = error.status;
    if (status === 404 || status === 410 || error.code === "not-found") {
      return { code: "not-found", message };
    }
    if (error.code === "parse-failed") {
      return { code: "parse-failed", message };
    }
    if (
      status === 401 ||
      status === 403 ||
      error.code === "blocked" ||
      error.code === "rate-limited"
    ) {
      return { code: "blocked", message };
    }
    if (error.code === "timeout") {
      return { code: "timeout", message };
    }
    if (error.code === "provider-unavailable" || (status !== undefined && status >= 500)) {
      return { code: "provider-unavailable", message };
    }
    return { code: "network-error", message };
  }
  // Structural before textual: a 404/410 page can carry any body, but the
  // status means the route is gone — retrying cannot heal it.
  if (/hianime fetch HTTP (404|410)\b/.test(message)) {
    return { code: "not-found", message };
  }
  if (/cloudflare|just a moment/i.test(message)) {
    return { code: "blocked", message };
  }
  return { code: "network-error", message };
}

/**
 * Ladder a lane's master playlist into per-quality links. A dead master host
 * (5xx/404/410) means the fallback `auto` row would point at the same dead
 * URL — drop it so the lane fails instead of playing a corpse. 403/timeout
 * stays: gatekept CDNs still play in mpv.
 */
async function expandLaneLinks(
  masterUrl: string,
  embedReferer: string,
  context: ProviderRuntimeContext,
  signal?: AbortSignal,
): Promise<{ links: HianimeStreamLink[]; ladderFallback: boolean }> {
  const ladderHeaders = {
    "User-Agent": HIANIME_USER_AGENT,
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
  const variants = isHlsDeadHostStatus(inventory.probe.httpStatus) ? [] : inventory.variants;
  const links: HianimeStreamLink[] = variants.map((variant) => ({
    url: variant.url,
    quality: variant.qualityLabel,
    qualityRank: variant.qualityRank,
    referer: embedReferer,
  }));
  if (links.length === 0) {
    // A definitive dead-host answer is upstream evidence, not a transient
    // transport failure — but keep the status fidelity: a gone route
    // (404/410) is terminal while a 5xx maintenance window may heal.
    const deadHostStatus = isHlsDeadHostStatus(inventory.probe.httpStatus)
      ? inventory.probe.httpStatus
      : undefined;
    throw new ProviderHttpError({
      message:
        deadHostStatus !== undefined
          ? `hianime master host answered HTTP ${deadHostStatus} — dead upstream`
          : "hianime ladder expansion returned no variants",
      providerId: HIANIME_PROVIDER_ID,
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
  // The ladder still returns the single `auto` fallback row (pointing at
  // the master URL, rank 0) when the fetched body is not a master playlist
  // — transport failures throw instead, and never reach this line. That
  // shape is the fallback's alone: a parsed variant never points at the
  // master with rank 0, so flag it for the trace instead of letting it
  // pose as a genuine single rung.
  const ladderFallback =
    links.length === 1 &&
    links[0]?.url === masterUrl &&
    links[0]?.quality === "auto" &&
    links[0]?.qualityRank === 0;
  return { links, ladderFallback };
}

/** ZokoAnime lane: embed page → `window.__P` XOR blob → master m3u8 → ladder. */
async function resolveZokoanimeLane(
  server: HianimeServerEntry,
  context: ProviderRuntimeContext,
  signal?: AbortSignal,
): Promise<HianimeResolvedLane> {
  const embedReferer = hianimeEmbedReferer(server.embedUrl);
  const embedHtml = await hianimeFetchText(server.embedUrl, {
    signal,
    context,
    referer: HIANIME_REFERER,
  });
  const payload = decodeHianimeEmbedPage(embedHtml);
  const { links, ladderFallback } = await expandLaneLinks(
    payload.src,
    embedReferer,
    context,
    signal,
  );
  const malId = hianimeMalIdFromEmbedUrl(server.embedUrl);
  return {
    status: "resolved",
    serverName: server.serverName,
    serverKind: "zokoanime",
    links,
    subtitles: payload.subtitles,
    ...(malId && { malId }),
    ...(payload.intro && { intro: payload.intro }),
    ...(payload.outro && { outro: payload.outro }),
    ...(payload.poster && { poster: payload.poster }),
    ...(payload.spriteVtt && { spriteVtt: payload.spriteVtt }),
    embedReferer,
    ...(ladderFallback && { ladderFallback: true as const }),
  };
}

/**
 * MegaPlay lane (HD-1, Vidstream-2): embed page → `data-id` → getSources XHR
 * → AES-256-CBC `enc` blob → master m3u8 → ladder. Same contract AnimeKai's
 * embeds speak; the `?s=` CDN selector on the embed URL rides into the
 * getSources call the way the player's own rewriter does.
 */
async function resolveMegaplayLane(
  server: HianimeServerEntry,
  context: ProviderRuntimeContext,
  signal?: AbortSignal,
): Promise<HianimeResolvedLane> {
  const embedReferer = megaplayEmbedReferer(server.embedUrl);
  const embedHtml = await hianimeFetchText(server.embedUrl, {
    signal,
    context,
    referer: HIANIME_REFERER,
  });
  // Dual-id deployments key getSources on `data-mediaid` while `data-id`
  // decrypts to an empty payload — walk every advertised id and let the
  // decrypt decide which one is real.
  const sourceIds = parseMegaplayEmbedSourceIds(embedHtml);
  if (sourceIds.length === 0) {
    throw new MegaplayEmbedDecodeError(
      "missing-data-id",
      "megaplay embed page exposes no player data-id",
    );
  }
  let masterUrl: string | undefined;
  let payload: MegaplaySourcesPayload | undefined;
  let lastError: unknown;
  for (const sourceId of sourceIds) {
    try {
      const sourcesRaw = await hianimeFetchText(
        megaplaySourcesEndpoint(server.embedUrl, sourceId),
        {
          signal,
          context,
          referer: embedReferer,
          extraHeaders: { "X-Requested-With": "XMLHttpRequest" },
        },
      );
      const sourcesJson = JSON.parse(sourcesRaw) as unknown;
      const parsed = parseMegaplaySourcesJson(sourcesJson);
      if (!parsed) {
        throw new MegaplayEmbedDecodeError(
          "missing-playlist",
          "megaplay getSources payload carries no enc blob",
        );
      }
      masterUrl = megaplayMasterUrlFromDecrypted(await decryptMegaplaySourcesBlob(parsed.enc));
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
      : new MegaplayEmbedDecodeError("decrypt-failed", "megaplay getSources answered non-JSON");
  }
  const { links, ladderFallback } = await expandLaneLinks(masterUrl, embedReferer, context, signal);
  const malId = hianimeMalIdFromEmbedUrl(server.embedUrl);
  return {
    status: "resolved",
    serverName: server.serverName,
    serverKind: "megaplay",
    links,
    subtitles: payload.tracks.map((track) => ({
      src: track.file,
      ...(track.label && { label: track.label }),
      ...(track.isDefault && { isDefault: true }),
    })),
    ...(malId && { malId }),
    ...(payload.intro && { intro: payload.intro }),
    ...(payload.outro && { outro: payload.outro }),
    embedReferer,
    ...(ladderFallback && { ladderFallback: true as const }),
  };
}

function resolveHianimeLane(
  server: HianimeServerEntry,
  context: ProviderRuntimeContext,
  signal?: AbortSignal,
): Promise<HianimeResolvedLane> {
  return hianimeServerKind(server) === "megaplay"
    ? resolveMegaplayLane(server, context, signal)
    : resolveZokoanimeLane(server, context, signal);
}

/**
 * Walk the mode's supported servers in the order the API offered them — a
 * dead lane records its failure and the walk moves to the next server, so a
 * rotten ZokoAnime does not take the episode down while HD-1 still plays.
 * The first resolved lane wins: further servers only cost round trips.
 */
export async function resolveHianimeEpisodeStreams({
  context,
  episodeId,
  requestedMode,
  onlyServerIndex,
  signal,
}: {
  readonly context: ProviderRuntimeContext;
  readonly episodeId: string;
  readonly requestedMode: HianimeAudioMode;
  /** A pinned source row (`source:hianime:<mode>:<n>`) resolves only that lane. */
  readonly onlyServerIndex?: number;
  readonly signal?: AbortSignal;
}): Promise<HianimeEpisodeStreamResolution> {
  let servers: readonly HianimeServerEntry[];
  try {
    servers = await fetchHianimeServers(episodeId, signal, context);
  } catch (error) {
    // One failure channel: a dead servers stage reports as a coded failure,
    // never as a throw (abort still propagates). With no listing there are no
    // observed modes or servers to report.
    if (signal?.aborted === true) throw error;
    return {
      availableModes: [],
      observedServers: [],
      laneNames: { sub: [], dub: [] },
      requested: {
        mode: requestedMode,
        status: "failed",
        servers: [],
        failure: failureOf(error),
      },
    };
  }
  const observedServers = [...new Set(servers.map((server) => server.serverName))];
  const supported = servers.filter((server) => hianimeServerKind(server) !== null);
  const availableModes = (["sub", "dub"] as const).filter((mode) =>
    supported.some((server) => server.audioMode === mode),
  );
  const laneNames: Record<HianimeAudioMode, string[]> = { sub: [], dub: [] };
  for (const server of supported) laneNames[server.audioMode].push(server.serverName);

  const modeServers = supported.filter((server) => server.audioMode === requestedMode);
  const lanes =
    onlyServerIndex === undefined
      ? modeServers
      : modeServers.filter((_, index) => index === onlyServerIndex);
  if (lanes.length === 0) {
    return {
      availableModes,
      observedServers,
      laneNames,
      requested: { mode: requestedMode, status: "unavailable", servers: [] },
    };
  }

  const resolutions: HianimeServerResolution[] = [];
  let firstFailure: HianimeStreamFailure | undefined;
  for (const server of lanes) {
    // Mode-local index keeps the source row stable regardless of how sub and
    // dub entries interleave in the endpoint's array.
    const index = modeServers.indexOf(server);
    try {
      const resolution = await resolveHianimeLane(server, context, signal);
      resolutions.push({ ...resolution, serverIndex: index });
      // One playable lane is enough — further servers only cost requests.
      break;
    } catch (error) {
      if (signal?.aborted === true) throw error;
      const failure = failureOf(error);
      firstFailure ??= failure;
      resolutions.push({
        status: "failed",
        serverIndex: index,
        serverName: server.serverName,
        failure,
      });
    }
  }

  const ok = resolutions.find((server) => server.status === "resolved");
  return {
    availableModes,
    observedServers,
    laneNames,
    requested: ok
      ? { mode: requestedMode, status: "resolved", servers: resolutions }
      : {
          mode: requestedMode,
          status: "failed",
          servers: resolutions,
          ...(firstFailure && { failure: firstFailure }),
        },
  };
}
