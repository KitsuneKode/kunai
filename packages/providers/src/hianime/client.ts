/**
 * HiAnime HTTP client: search, episode catalog, servers, embed, HLS ladder.
 *
 * `hianime.at` HTML/JSON usually answers plain fetch, but the whole lane sits
 * behind Cloudflare, so metadata reads prefer the injected fetch port (which
 * carries the user-owned relay when configured) and fall back to local
 * curl/curl-impersonate — the same shape as the AniDB client.
 */

import { isRelayedResponse, providerHttpErrorForStatus } from "@kunai/types";
import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { ProviderHttpError } from "../runtime/fetch";
import { scrubbedChildEnv } from "../shared/child-env";
import {
  curlCipherArgs,
  isCloudflareChallengeText,
  resolveCurlCandidate,
} from "../shared/curl-impersonate";
import { expandHlsMasterInventory, isHlsDeadHostStatus } from "../shared/hls-ladder";
import { TTLCache } from "../shared/provider-cache";
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

export type HianimeModeResolution =
  | {
      readonly mode: HianimeAudioMode;
      readonly status: "resolved";
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
    }
  | {
      readonly mode: HianimeAudioMode;
      readonly status: "unavailable";
    }
  | {
      readonly mode: HianimeAudioMode;
      readonly status: "failed";
      readonly failure: {
        readonly code: HianimeStreamFailureCode;
        readonly message: string;
      };
    };

export type HianimeEpisodeStreamResolution = {
  /** Modes with a supported (ZokoAnime) server for this episode. */
  readonly availableModes: readonly HianimeAudioMode[];
  /** Every native server name the servers API listed (supported or not). */
  readonly observedServers: readonly string[];
  readonly requested: HianimeModeResolution;
};

const CURL_TIMEOUT_EXIT_CODE = 28;

/**
 * Split curl's `-w '\n%{http_code}'` trailer into `{ body, httpCode }`.
 * `httpCode` is null when curl never received an HTTP response (DNS, TCP, or
 * TLS failure) — the ani-cli 5.1.4 distinction between "no HTTP response"
 * and "HTTP NNN", so a dead route is never misread as an HTTP error. curl
 * prints `000` for that case, which is a missing status, not status zero.
 * Only one trailing line is ever cut, so a body that naturally ends in
 * `\nNNN` keeps its bytes.
 */
export type CurlHttpTrailer = {
  readonly body: string;
  readonly httpCode: number | null;
};

export function splitCurlHttpTrailer(stdout: string): CurlHttpTrailer {
  const match = /\n(\d{3})$/.exec(stdout);
  if (!match?.[1]) return { body: stdout, httpCode: null };
  const code = Number(match[1]);
  const body = stdout.slice(0, stdout.length - match[0].length);
  return { body, httpCode: code === 0 ? null : code };
}

/**
 * The request label for error messages: origin + path, never the query —
 * `/search?keyword=…` would otherwise write the user's title query into an
 * error that lands in logs.txt.
 */
export function hianimeUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/** Name the failed layer first: transport (`no HTTP response`) or HTTP status. */
export function hianimeCurlFailureMessage(
  stdout: string,
  stderr: string,
  exitCode: number,
  url?: string,
): string {
  const { httpCode } = splitCurlHttpTrailer(stdout);
  const detail = httpCode !== null ? `HTTP ${httpCode}` : "no HTTP response";
  const tail = stderr.trim();
  const where = url ? ` from ${hianimeUrlLabel(url)}` : "";
  return `hianime fetch connection error (${detail}; curl exit ${exitCode})${where}${tail ? `: ${tail}` : ""}`;
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
  let result = await spawnCurlOnce(args, signal);
  if (result.exitCode === CURL_TIMEOUT_EXIT_CODE) {
    result = await spawnCurlOnce(args, signal);
  }
  if (result.exitCode !== 0) {
    throw new Error(hianimeCurlFailureMessage(result.stdout, result.stderr, result.exitCode, url));
  }
  return result.stdout;
}

function spawnCurlOnce(
  args: readonly string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([...args], {
    stdout: "pipe",
    stderr: "pipe",
    signal,
    env: scrubbedChildEnv(),
  });
  return Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }));
}

/**
 * A response the relay port marked as relayed is final: re-asking the same
 * upstream URL direct would silently bypass the relay the user deployed.
 * Transport errors and *direct* (unmarked) responses still fall through to
 * local curl/impersonate — that path is the legitimate Cloudflare bypass.
 */
class HianimeRelayedUpstreamError extends Error {}

export async function hianimeFetchText(
  url: string,
  options: {
    readonly context?: ProviderRuntimeContext;
    readonly signal?: AbortSignal;
    readonly maxTimeSec?: number;
    readonly referer?: string;
  } = {},
): Promise<string> {
  const referer = options.referer ?? HIANIME_REFERER;
  if (options.context?.fetch) {
    try {
      const response = await options.context.fetch.fetch(url, {
        headers: { "User-Agent": HIANIME_USER_AGENT, Referer: referer },
        signal: createTimeoutSignal(options.signal, 15_000),
      });
      if (isRelayedResponse(response)) {
        /* The relay answered for this request — re-asking the same URL direct
         * would silently bypass the relay the user deployed (#460). Treat the
         * response as final, including a definitive upstream status. */
        const text = response.ok ? await response.text() : "";
        if (response.ok && !isCloudflareChallengeText(text)) return text;
        throw new HianimeRelayedUpstreamError(
          isCloudflareChallengeText(text)
            ? cloudflareBlockMessage(false)
            : `hianime fetch HTTP ${response.status} from ${hianimeUrlLabel(url)} via relay`,
        );
      }
      if (response.ok) {
        const text = await response.text();
        if (!isCloudflareChallengeText(text)) return text;
      }
    } catch (error) {
      if (options.signal?.aborted === true) throw error;
      if (error instanceof HianimeRelayedUpstreamError) throw error;
      // Fall through to local curl/impersonate.
    }
  }

  const curl = resolveCurlCandidate();
  if (!curl) {
    const response = await fetch(url, {
      headers: { "User-Agent": HIANIME_USER_AGENT, Referer: referer },
      signal: createTimeoutSignal(options.signal, 15_000),
    });
    if (!response.ok) {
      // The status rides the error so classification reads the structure, not
      // the message string (#458).
      throw providerHttpErrorForStatus({
        status: response.status,
        message: `hianime fetch HTTP ${response.status} from ${hianimeUrlLabel(url)}`,
        providerId: HIANIME_PROVIDER_ID,
        stage: "fetch-page",
      });
    }
    const text = await response.text();
    if (isCloudflareChallengeText(text)) {
      throw new Error("hianime blocked by Cloudflare (install curl)");
    }
    return text;
  }

  const args = [
    curl.path,
    ...curl.prefixArgs,
    "-sL",
    "-A",
    HIANIME_USER_AGENT,
    "-H",
    `Referer: ${referer}`,
    "--max-time",
    String(options.maxTimeSec ?? 12),
    ...curlCipherArgs(curl.impersonates),
    "-w",
    "\n%{http_code}",
    url,
  ];
  // Exit 0 only means curl is happy: a 403/404/410 page still needs the
  // status check below (ani-cli `hianime_curl` parity), otherwise an error
  // page flows into JSON parsing and misreports as `parse-failed`.
  const { body, httpCode } = splitCurlHttpTrailer(
    await runHianimeCurlWithRetry(args, options.signal, url),
  );
  // Name the leg. A hianime resolve is four network hops (episodes, servers,
  // embed page, master playlist) and "hianime fetch HTTP 503" says which of
  // them died to nobody. The layer name and curl exit already ride along on
  // the transport-failure path; this is the same courtesy for the status path.
  // Parity: ani-cli's `hianime_curl` names the URL on both exits.
  if (httpCode !== null && (httpCode < 200 || httpCode > 299)) {
    if (isCloudflareChallengeText(body)) {
      throw new Error(cloudflareBlockMessage(curl.impersonates));
    }
    throw providerHttpErrorForStatus({
      status: httpCode,
      message: `hianime fetch HTTP ${httpCode} from ${hianimeUrlLabel(url)}`,
      providerId: HIANIME_PROVIDER_ID,
      stage: "fetch-page",
    });
  }
  if (isCloudflareChallengeText(body)) {
    throw new Error(cloudflareBlockMessage(curl.impersonates));
  }
  return body;
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

function isSupportedServer(serverName: string): boolean {
  return (
    serverName.localeCompare(HIANIME_SUPPORTED_SERVER, undefined, { sensitivity: "accent" }) === 0
  );
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

export async function resolveHianimeEpisodeStreams({
  context,
  episodeId,
  requestedMode,
  signal,
}: {
  readonly context: ProviderRuntimeContext;
  readonly episodeId: string;
  readonly requestedMode: HianimeAudioMode;
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
      requested: { mode: requestedMode, status: "failed", failure: failureOf(error) },
    };
  }
  const observedServers = [...new Set(servers.map((server) => server.serverName))];
  const supported = servers.filter((server) => isSupportedServer(server.serverName));
  const availableModes = (["sub", "dub"] as const).filter((mode) =>
    supported.some((server) => server.audioMode === mode),
  );

  const embedUrl = supported.find((server) => server.audioMode === requestedMode)?.embedUrl;
  if (!embedUrl) {
    return {
      availableModes,
      observedServers,
      requested: { mode: requestedMode, status: "unavailable" },
    };
  }

  try {
    const embedReferer = hianimeEmbedReferer(embedUrl);
    const embedHtml = await hianimeFetchText(embedUrl, {
      signal,
      context,
      referer: HIANIME_REFERER,
    });
    const payload = decodeHianimeEmbedPage(embedHtml);
    const ladderHeaders = {
      "User-Agent": HIANIME_USER_AGENT,
      Referer: embedReferer,
      Origin: embedReferer.replace(/\/$/, ""),
    };
    const fetchImpl =
      context.fetch?.fetch.bind(context.fetch) ??
      ((url: string, init?: RequestInit) => fetch(url, init));
    const inventory = await expandHlsMasterInventory({
      fetch: fetchImpl,
      resolvesLocally: context.fetch?.resolvesLocally,
      masterUrl: payload.src,
      headers: ladderHeaders,
      signal: createTimeoutSignal(signal, 15_000),
    });
    // A dead master host (5xx/404/410) means the fallback `auto` row would point
    // at the same dead URL — drop it so the caller fails instead of playing a
    // corpse. 403/timeout stays: gatekept CDNs still play in mpv.
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
      return {
        availableModes,
        observedServers,
        requested: {
          mode: requestedMode,
          status: "failed",
          failure: {
            code:
              deadHostStatus !== undefined
                ? deadHostStatus >= 500
                  ? "provider-unavailable"
                  : "not-found"
                : "network-error",
            message:
              deadHostStatus !== undefined
                ? `hianime master host answered HTTP ${deadHostStatus} — dead upstream`
                : "hianime ladder expansion returned no variants",
          },
        },
      };
    }
    const malId = hianimeMalIdFromEmbedUrl(embedUrl);
    // The ladder still returns the single `auto` fallback row (pointing at
    // the master URL, rank 0) when the fetched body is not a master playlist
    // — transport failures throw instead, and never reach this line. That
    // shape is the fallback's alone: a parsed variant never points at the
    // master with rank 0, so flag it for the trace instead of letting it
    // pose as a genuine single rung.
    const ladderFallback =
      links.length === 1 &&
      links[0]?.url === payload.src &&
      links[0]?.quality === "auto" &&
      links[0]?.qualityRank === 0;
    return {
      availableModes,
      observedServers,
      requested: {
        mode: requestedMode,
        status: "resolved",
        links,
        subtitles: payload.subtitles,
        ...(malId && { malId }),
        ...(payload.intro && { intro: payload.intro }),
        ...(payload.outro && { outro: payload.outro }),
        ...(payload.poster && { poster: payload.poster }),
        ...(payload.spriteVtt && { spriteVtt: payload.spriteVtt }),
        embedReferer,
        ...(ladderFallback && { ladderFallback: true as const }),
      },
    };
  } catch (error) {
    if (signal?.aborted === true) throw error;
    return {
      availableModes,
      observedServers,
      requested: { mode: requestedMode, status: "failed", failure: failureOf(error) },
    };
  }
}
