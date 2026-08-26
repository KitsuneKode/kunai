import { createDecipheriv } from "node:crypto";

import type { ProviderEpisodeIdentity, ProviderRuntimeContext } from "@kunai/types";

import { providerFetch } from "../runtime/fetch";
import {
  allMangaEpisodeMetadataCacheKey,
  enrichEpisodeOptionsWithAnimeMetadata,
  fetchAnimeEpisodeMetadataByNumber,
  getSeededEpisodeMetadata,
  mergeExternalEpisodeMetadataInto,
  parseAllMangaEpisodeNumber,
  seedEpisodeMetadataFromProvider,
  shouldSkipExternalEpisodeMetadataEnrichment,
  type AnimeEpisodeMetadata,
} from "../shared/anime-metadata";
import { expandHlsMasterPlaylist } from "../shared/hls-ladder";
import { TTLCache } from "../shared/provider-cache";
import { createTimeoutSignal } from "../shared/timeout-signal";
import {
  ALLMANGA_BUILD_ID,
  ALLMANGA_CRYPTO_MATERIAL_TTL_MS,
  ALLMANGA_KEY_HEX,
  ALLMANGA_SITE_ORIGIN,
  BUNDLED_ALLMANGA_CRYPTO,
  buildAllMangaAaReq,
  fetchAllMangaCryptoMaterial,
  type AllMangaCryptoMaterial,
} from "./crypto";
import { ALLANIME_PROVIDER_ID } from "./manifest";

export {
  ALLMANGA_BUILD_ID,
  ALLMANGA_CONTENT_LANE_EPISODE,
  ALLMANGA_EPOCH,
  ALLMANGA_KEY_HEX,
  ALLMANGA_QUERY_HASH,
  BUNDLED_ALLMANGA_CRYPTO,
  buildAllMangaAaReq,
  buildAllMangaBootToken,
  currentAllMangaEpochCandidates,
  deriveKeyFromPartB,
  deriveMaskKey,
  hashBuildId,
  type AllMangaCryptoMaterial,
} from "./crypto";

export type AllMangaSearchResult = {
  readonly id: string;
  readonly title: string;
  readonly englishTitle?: string;
  readonly nativeTitle?: string;
  readonly type: "series";
  readonly year?: string;
  readonly posterUrl?: string;
  readonly bannerUrl?: string;
  readonly malId?: number;
  readonly aniListId?: number;
  readonly description?: string;
  readonly score?: number;
  readonly averageScore?: number;
  readonly popularity?: number;
  readonly genres?: readonly string[];
  readonly altNames?: readonly string[];
  readonly epCount?: number;
  readonly availableAudioModes?: readonly ("sub" | "dub")[];
};

export type AllMangaEpisodeOption = {
  readonly index: number;
  readonly label: string;
  readonly providerEpisodeIdentity?: ProviderEpisodeIdentity;
  readonly detail?: string;
  readonly totalEpisodeCount?: number;
  readonly externalIds?: {
    readonly anilistId?: string;
    readonly malId?: string;
  };
  readonly artwork?: {
    readonly thumbnailUrl?: string;
  };
};

export type StreamLink = {
  readonly url: string;
  readonly quality: string;
  /** API source family (Default, Yt-mp4, Ak, …) when known. */
  readonly sourceName?: string;
  readonly referer?: string;
  readonly subtitle?: string;
  /** All subtitles from the API response with language metadata. */
  readonly subtitles?: readonly { lang: string; src: string }[];
  readonly protocol?: "hls" | "dash" | "mp4";
  readonly container?: "m3u8" | "mpd" | "mp4";
  readonly deferredLocator?: string;
};

export type AllMangaAkRepresentation = {
  readonly url: string;
  readonly mimeType?: string;
  readonly codecs?: string;
  readonly width?: number;
  readonly height?: number;
  readonly bandwidth?: number;
  readonly audioSamplingRate?: number;
  readonly frameRate?: string | number;
  readonly language?: string;
  readonly indexRange?: string;
  readonly initializationRange?: string;
};

export type AllMangaAkDeferredDescriptor = {
  readonly video: AllMangaAkRepresentation;
  readonly audio: AllMangaAkRepresentation;
  readonly duration?: number;
};

export type AllMangaSourceLane = "baseline" | "ak-only";

/**
 * AllManga crypto lives in `./crypto.ts` (mkissa rotating buildId + bootstrap).
 * `tobeparsed` remains AES-256-GCM; API base is `api.mkissa.net` with
 * Referer/Origin `https://mkissa.to`. Rate-limit bursts still get a soft retry.
 */

const HEX: Record<string, string> = {
  "79": "A",
  "7a": "B",
  "7b": "C",
  "7c": "D",
  "7d": "E",
  "7e": "F",
  "7f": "G",
  "70": "H",
  "71": "I",
  "72": "J",
  "73": "K",
  "74": "L",
  "75": "M",
  "76": "N",
  "77": "O",
  "68": "P",
  "69": "Q",
  "6a": "R",
  "6b": "S",
  "6c": "T",
  "6d": "U",
  "6e": "V",
  "6f": "W",
  "60": "X",
  "61": "Y",
  "62": "Z",
  "59": "a",
  "5a": "b",
  "5b": "c",
  "5c": "d",
  "5d": "e",
  "5e": "f",
  "5f": "g",
  "50": "h",
  "51": "i",
  "52": "j",
  "53": "k",
  "54": "l",
  "55": "m",
  "56": "n",
  "57": "o",
  "48": "p",
  "49": "q",
  "4a": "r",
  "4b": "s",
  "4c": "t",
  "4d": "u",
  "4e": "v",
  "4f": "w",
  "40": "x",
  "41": "y",
  "42": "z",
  "08": "0",
  "09": "1",
  "0a": "2",
  "0b": "3",
  "0c": "4",
  "0d": "5",
  "0e": "6",
  "0f": "7",
  "00": "8",
  "01": "9",
  "15": "-",
  "16": ".",
  "67": "_",
  "46": "~",
  "02": ":",
  "17": "/",
  "07": "?",
  "1b": "#",
  "63": "[",
  "65": "]",
  "78": "@",
  "19": "!",
  "1c": "$",
  "1e": "&",
  "10": "(",
  "11": ")",
  "12": "*",
  "13": "+",
  "14": ",",
  "03": ";",
  "05": "=",
  "1d": "%",
};

// ani-cli handles Default/Yt-mp4/S-mp4/Mp4 upstream; Fm-mp4 (filemoon) was
// removed upstream in b8032b7 and no longer ships a compatible payload.
const KNOWN_SOURCES = new Set(["Default", "Yt-mp4", "S-mp4", "Mp4", "Luf-Mp4", "Ak"]);
const MP4UPLOAD_REFERER = "https://www.mp4upload.com";
export const ALLMANGA_BASELINE_ADAPTER_WAIT_BUDGET_MS = 1_500;
const ALLMANGA_AK_DEFERRED_TTL_MS = 5 * 60_000;
const ALLMANGA_AK_DEFERRED_MAX_ENTRIES = 128;
let providerCacheNow = Date.now;
const readProviderCacheClock = () => providerCacheNow();
const akDeferredRegistry = new TTLCache<string, AllMangaAkDeferredDescriptor>(
  ALLMANGA_AK_DEFERRED_TTL_MS,
  {
    maxEntries: ALLMANGA_AK_DEFERRED_MAX_ENTRIES,
    now: readProviderCacheClock,
  },
);
let akDeferredCounter = 0;

export function registerAllMangaAkDeferredDescriptor(
  descriptor: AllMangaAkDeferredDescriptor,
): string {
  akDeferredCounter += 1;
  const locator = `allmanga-ak:${providerCacheNow().toString(36)}-${akDeferredCounter.toString(36)}`;
  akDeferredRegistry.set(locator, descriptor);
  return locator;
}

export function resolveAllMangaAkDeferredLocator(
  locator: string,
): AllMangaAkDeferredDescriptor | null {
  return akDeferredRegistry.get(locator) ?? null;
}

export function releaseAllMangaAkDeferredLocator(locator: string): void {
  akDeferredRegistry.delete(locator);
}

export function setAllMangaProviderCacheClockForTest(now: () => number): void {
  showCatalogCache.clear();
  sourceCache.clear();
  akDeferredRegistry.clear();
  akDeferredCounter = 0;
  providerCacheNow = now;
}

export function hexDecode(encoded: string): string {
  let out = "";
  for (let i = 0; i + 1 < encoded.length; i += 2) {
    const pair = encoded.slice(i, i + 2);
    out += HEX[pair] ?? pair;
  }
  return out.replace(/\/clock\b/g, "/clock.json");
}

export async function decodeTobeparsed(
  blob: string,
  keyHex: string = ALLMANGA_KEY_HEX,
): Promise<Array<{ sourceName: string; sourceUrl: string }>> {
  const plain = await decryptTobeparsedPlaintext(blob, keyHex);
  if (!plain) return [];
  return extractRawSourcesFromPlaintext(plain);
}

/**
 * Decrypt the tobeparsed blob with the live material's key, falling back to the
 * bundled key when the live key fails. During a crypto-epoch rollover the API
 * can still seal blobs under the previous epoch's key while bootstrap already
 * serves the next one; without this fallback those episodes resolve to a silent
 * empty result.
 */
export async function decryptTobeparsedWithEpochFallback(
  blob: string,
  materialKeyHex: string | undefined,
): Promise<string | null> {
  if (materialKeyHex && materialKeyHex !== ALLMANGA_KEY_HEX) {
    const withLiveKey = await decryptTobeparsedPlaintext(blob, materialKeyHex);
    if (withLiveKey !== null) return withLiveKey;
  }
  return decryptTobeparsedPlaintext(blob, ALLMANGA_KEY_HEX);
}

/**
 * Decrypt the API's `tobeparsed` blob (ani-cli `process_tobeparsed`).
 * Layout: base64(0x01 || iv12 || ciphertext || gcmTag16), AES-256-GCM.
 */
export async function decryptTobeparsedPlaintext(
  blob: string,
  keyHex: string = ALLMANGA_KEY_HEX,
): Promise<string | null> {
  try {
    const raw = Buffer.from(blob, "base64");
    if (raw.length <= 1 + 12 + 16) return null;
    const iv = raw.subarray(1, 13);
    const rest = raw.subarray(13);
    const ciphertext = rest.subarray(0, rest.length - 16);
    const tag = rest.subarray(rest.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

const ALLMANGA_EPISODE_THUMBNAIL_ORIGIN = "https://wp.youtube-anime.com/aln.youtube-anime.com";

function extractRawSourcesFromPlaintext(
  text: string,
): Array<{ sourceName: string; sourceUrl: string }> {
  const results: Array<{ sourceName: string; sourceUrl: string }> = [];
  // Match ani-cli: capture any sourceUrl (hex `--…` or direct https embed), not only `--`.
  const pattern = /"sourceUrl"\s*:\s*"([^"]+)"[^}]*"sourceName"\s*:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const [, sourceUrl, sourceName] = match;
    if (sourceUrl && sourceName) {
      results.push({ sourceUrl, sourceName });
    }
  }
  return results;
}

/**
 * Build the AllAnime `aaReq` attestation — see `./crypto.ts`.
 */

let cachedCryptoMaterial: { readonly material: AllMangaCryptoMaterial; expiresAt: number } | null =
  null;
let inFlightCryptoMaterial: Promise<AllMangaCryptoMaterial | null> | null = null;
let cryptoMaterialOverrideForTest: AllMangaCryptoMaterial | null = null;
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return Bun.sleep(ms);
  if (signal.aborted) return Promise.resolve();
  return Promise.race([
    Bun.sleep(ms),
    new Promise<void>((resolve) => {
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }),
  ]);
}

let retrySleep: (ms: number, signal?: AbortSignal) => Promise<void> = (ms, signal) =>
  sleepAbortable(ms, signal);

export function setAllMangaCryptoMaterialForTest(material: AllMangaCryptoMaterial | null): void {
  cryptoMaterialOverrideForTest = material;
}

export function setAllMangaRetrySleepForTest(
  sleep: ((ms: number, signal?: AbortSignal) => Promise<void>) | null,
): void {
  retrySleep = sleep ?? sleepAbortable;
}

/**
 * Crypto material for the episode persisted query: cached when fresh, derived
 * live via mkissa bootstrap otherwise. Falls back to bundled material when
 * bootstrap fails so resolve degrades to a plain AA_CRYPTO_* miss instead of a
 * hard error.
 */
export async function getAllMangaCryptoMaterial(
  context: ProviderRuntimeContext,
  ua: string,
  signal?: AbortSignal,
): Promise<AllMangaCryptoMaterial | null> {
  if (cryptoMaterialOverrideForTest) return cryptoMaterialOverrideForTest;
  if (cachedCryptoMaterial && cachedCryptoMaterial.expiresAt > Date.now()) {
    return cachedCryptoMaterial.material;
  }
  return refreshAllMangaCryptoMaterial(context, ua, signal);
}

/** Force a live re-derivation (AA_CRYPTO_STALE recovery); dedupes concurrent callers. */
export function refreshAllMangaCryptoMaterial(
  context: ProviderRuntimeContext,
  ua: string,
  signal?: AbortSignal,
): Promise<AllMangaCryptoMaterial | null> {
  if (cryptoMaterialOverrideForTest) return Promise.resolve(cryptoMaterialOverrideForTest);
  inFlightCryptoMaterial ??= fetchAllMangaCryptoMaterial(context, ua, signal)
    .then((material) => {
      const resolved = material ?? BUNDLED_ALLMANGA_CRYPTO;
      cachedCryptoMaterial = {
        material: resolved,
        // A failed bootstrap falls back to bundled material; retry sooner.
        expiresAt: Date.now() + (material ? ALLMANGA_CRYPTO_MATERIAL_TTL_MS : 60_000),
      };
      return resolved;
    })
    .finally(() => {
      inFlightCryptoMaterial = null;
    });
  return inFlightCryptoMaterial;
}

function normalizeShowThumbnail(path: string | undefined): string | undefined {
  if (!path?.trim()) return undefined;
  const trimmed = path.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `${ALLMANGA_EPISODE_THUMBNAIL_ORIGIN}/${trimmed.replace(/^\//, "")}`;
}

function normalizeAllMangaEpisodeThumbnail(path: string | undefined): string | undefined {
  if (!path?.trim()) return undefined;
  const trimmed = path.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${ALLMANGA_EPISODE_THUMBNAIL_ORIGIN}${normalized}`;
}

function readAllMangaEpisodeNumber(episodeString: string | undefined): number | null {
  if (!episodeString?.trim()) return null;
  const parsed = episodeOrderValue(episodeString.trim());
  return parsed !== null && parsed > 0 ? parsed : null;
}

function seedAllMangaEpisodeInfoFromPlaintext(
  showId: string,
  mode: "sub" | "dub",
  plainText: string,
): void {
  let episode: Record<string, unknown> | undefined;
  try {
    const payload = JSON.parse(plainText) as { episode?: Record<string, unknown> };
    episode = payload.episode;
  } catch {
    episode = undefined;
  }
  if (!episode) return;

  const episodeInfo =
    episode.episodeInfo && typeof episode.episodeInfo === "object"
      ? (episode.episodeInfo as Record<string, unknown>)
      : undefined;
  const notes =
    (typeof episodeInfo?.notes === "string" ? episodeInfo.notes : undefined) ??
    (typeof episode.notes === "string" ? episode.notes : undefined);
  const synopsis =
    typeof episodeInfo?.description === "string"
      ? episodeInfo.description
      : typeof episode.description === "string"
        ? episode.description
        : undefined;
  const thumbnails = Array.isArray(episodeInfo?.thumbnails)
    ? episodeInfo.thumbnails.filter((value): value is string => typeof value === "string")
    : [];
  const uploadDates =
    episodeInfo?.uploadDates && typeof episodeInfo.uploadDates === "object"
      ? (episodeInfo.uploadDates as Record<string, unknown>)
      : undefined;
  const airDateRaw = uploadDates?.[mode];
  const airDate = typeof airDateRaw === "string" ? airDateRaw.slice(0, 10) : undefined;
  const episodeString =
    typeof episode.episodeString === "string" ? episode.episodeString : undefined;
  const number = readAllMangaEpisodeNumber(episodeString);
  if (!number) return;

  const entry: AnimeEpisodeMetadata = {
    number,
    title: notes?.trim() || undefined,
    synopsis: synopsis?.trim() || undefined,
    airDate,
    thumbnail: normalizeAllMangaEpisodeThumbnail(thumbnails[0]),
    source: "allmanga",
  };
  seedEpisodeMetadataFromProvider(allMangaEpisodeMetadataCacheKey(showId, mode), [entry]);
}

export function buildStreamHeaders(
  streamReferer: string | undefined,
  fallbackReferer: string | undefined,
  ua: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": ua,
  };
  const referer = streamReferer ?? fallbackReferer;
  if (referer) {
    headers.Referer = referer;
  }
  return headers;
}

export function resolveAnimeEpisodeString(
  episodeStrings: readonly string[],
  requestedEpisode: number,
): string {
  const exact = episodeStrings.find(
    (episodeString) => episodeOrderValue(episodeString) === requestedEpisode,
  );
  if (exact) return exact;
  // Positional fallback must match catalog display order: the UI numbers
  // episodes after sorting (`fetchAllMangaEpisodeCatalog`), so resolving
  // against raw upstream order picks a different entry whenever upstream
  // is not pre-sorted — only visible for non-numeric strings ("SP1", "OVA").
  const sorted = [...episodeStrings].sort(compareEpisodeStrings);
  return sorted[requestedEpisode - 1] ?? String(requestedEpisode);
}

/** listEpisodes + resolveStream both query this; dedupe within a short window to avoid double network per play. */
const AVAILABLE_EPISODES_DETAIL_TTL_MS = 45_000;
/** Extended show metadata returned alongside episode detail. */
export type ShowCatalogInfo = {
  readonly detail: Record<string, unknown[]>;
  readonly episodeCount?: number;
  readonly aniListId?: number;
  readonly malId?: number;
  readonly status?: string;
  readonly thumbnail?: string;
};

/** Cache extended show metadata per showId. TTL same 45s as episode detail. */
const showCatalogCache = new TTLCache<string, ShowCatalogInfo>(AVAILABLE_EPISODES_DETAIL_TTL_MS, {
  now: readProviderCacheClock,
});

/** Cache source resolve results per show+episode+mode. TTL 5 minutes. */
const sourceCache = new TTLCache<string, StreamLink[]>(300_000, {
  now: readProviderCacheClock,
});

export function clearAllMangaProviderCachesForTest(): void {
  showCatalogCache.clear();
  sourceCache.clear();
  akDeferredRegistry.clear();
  akDeferredCounter = 0;
  providerCacheNow = Date.now;
  cachedCryptoMaterial = null;
  cryptoMaterialOverrideForTest = null;
  retrySleep = (ms, signal) => sleepAbortable(ms, signal);
}

export async function loadAvailableEpisodesDetail(
  context: ProviderRuntimeContext,
  apiUrl: string,
  referer: string,
  ua: string,
  showId: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown[]>> {
  const info = await loadShowCatalogInfo(context, apiUrl, referer, ua, showId, signal);
  return info.detail;
}

/** Fetch show metadata + episode detail in one GraphQL call. */
export async function loadShowCatalogInfo(
  context: ProviderRuntimeContext,
  apiUrl: string,
  referer: string,
  ua: string,
  showId: string,
  signal?: AbortSignal,
): Promise<ShowCatalogInfo> {
  const cacheKey = `${apiUrl}\n${showId}`;
  const cached = showCatalogCache.get(cacheKey);
  if (cached) return cached;

  const query = `query($id:String!){
    show(_id:$id){
      availableEpisodesDetail
      episodeCount
      malId
      aniListId
      thumbnail
      availableEpisodes
    }
  }`;

  let data = (await gqlPost(context, apiUrl, referer, ua, query, { id: showId }, signal)) as
    | {
        data: {
          show: {
            availableEpisodesDetail: Record<string, unknown[]>;
            episodeCount?: string | number | null;
            malId?: string | number | null;
            aniListId?: string | number | null;
            thumbnail?: string;
            availableEpisodes?: Record<string, unknown>;
          };
        };
      }
    | null
    | undefined;

  if (!data?.data?.show?.availableEpisodesDetail) {
    data = (await gqlPost(
      context,
      apiUrl,
      "https://mkissa.to",
      ua,
      query,
      {
        id: showId,
      },
      signal,
    )) as typeof data;
  }

  const show = data?.data?.show;
  const info: ShowCatalogInfo = {
    detail: show?.availableEpisodesDetail ?? ({} as Record<string, unknown[]>),
    episodeCount: show?.episodeCount ? Number(show.episodeCount) : undefined,
    aniListId: show?.aniListId ? Number(show.aniListId) : undefined,
    malId: show?.malId ? Number(show.malId) : undefined,
    thumbnail: normalizeShowThumbnail(show?.thumbnail),
  };

  // Both attempts came back without a show: a timeout, 429, 5xx, or an upstream
  // rotation, not a catalog that is genuinely empty. Caching the synthesised
  // `{}` pinned an empty episode list for the full TTL, so a transient failure
  // kept showing "no episodes" long after AllAnime recovered.
  //
  // The empty info is still returned for *this* call — the callers already
  // handle an empty detail — it simply is not remembered as fact.
  if (!show?.availableEpisodesDetail) return info;

  showCatalogCache.set(cacheKey, info);
  return info;
}

export async function gqlPost(
  context: ProviderRuntimeContext,
  apiUrl: string,
  referer: string,
  ua: string,
  query: string,
  vars: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown | null> {
  try {
    const response = await providerFetch(context, apiUrl, {
      method: "POST",
      signal: createTimeoutSignal(signal, 20_000),
      headers: { "Content-Type": "application/json", Referer: referer, "User-Agent": ua },
      body: JSON.stringify({ query, variables: vars }),
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export async function gqlRaw(
  context: ProviderRuntimeContext,
  apiUrl: string,
  referer: string,
  ua: string,
  query: string,
  vars: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const response = await providerFetch(context, apiUrl, {
      method: "POST",
      signal: createTimeoutSignal(signal, 20_000),
      headers: { "Content-Type": "application/json", Referer: referer, "User-Agent": ua },
      body: JSON.stringify({ query, variables: vars }),
    });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
}

/**
 * The AllAnime/mkissa API answers the episode-sources query with `NEED_CAPTCHA`
 * when the caller's network is bot- or geo-gated. The episode *catalog* query is
 * not gated, so the symptom is a full episode list next to zero streams.
 *
 * This is not a crypto fault: build id, bootstrap material, `aaReq`, and the
 * persisted query hash are all accepted when it happens. Re-bootstrapping or
 * retrying the identical request cannot clear it, so it must fail loudly and
 * point at the one thing that does help — a user-owned relay in an ungated
 * region (`providerRelay.baseUrl`, see `.docs/providers.md`).
 */
export class AllMangaCaptchaError extends Error {
  readonly code = "allmanga-captcha-required" as const;

  constructor() {
    super(
      "AllAnime requires a captcha for stream sources from this network. " +
        "The episode catalog still loads, which is why the episode list looks healthy. " +
        "Configure a user-owned provider relay (providerRelay.baseUrl) in an ungated region.",
    );
    this.name = "AllMangaCaptchaError";
  }
}

/** Distinguishes the captcha gate from crypto staleness and rate limiting. */
export function isAllMangaCaptchaResponse(rawText: string): boolean {
  return rawText.includes("NEED_CAPTCHA");
}

export async function resolveEpisodeSources(opts: {
  readonly context: ProviderRuntimeContext;
  readonly apiUrl: string;
  readonly referer: string;
  readonly ua: string;
  readonly showId: string;
  readonly epStr: string;
  readonly mode: "sub" | "dub";
  readonly sourceLane?: AllMangaSourceLane;
  readonly adapterWaitBudgetMs?: number;
  readonly signal?: AbortSignal;
}): Promise<StreamLink[]> {
  const { context, apiUrl, referer, ua, showId, epStr, mode, signal } = opts;
  const sourceLane = opts.sourceLane ?? "baseline";

  // Check source cache (episode string + mode → StreamLink[])
  const cacheKey = `${showId}:${epStr}:${mode}:${sourceLane}`;
  const cached = sourceCache.get(cacheKey);
  if (cached) {
    const deferredLocators = cached.flatMap((link) =>
      link.deferredLocator ? [link.deferredLocator] : [],
    );
    if (deferredLocators.length === 0) return cached;

    // Deferred Ak handles are one-consumer capabilities. A materializer releases
    // its handle after playback, so replaying this cache entry would return a
    // dead stream. Evict defensively for entries created by older code too.
    sourceCache.delete(cacheKey);
    for (const locator of deferredLocators) releaseAllMangaAkDeferredLocator(locator);
  }

  // GET with persisted query + aaReq attestation (mkissa buildId scheme).
  // Without aaReq the API returns AA_CRYPTO_MISSING; a rotated key/epoch/build
  // returns AA_CRYPTO_STALE/INVALID/MISSING_BUILD — recover by re-bootstrapping.
  const vars = { showId, translationType: mode, episodeString: epStr };
  const maxAttempts = 5;

  let material = await getAllMangaCryptoMaterial(context, ua, signal);
  let rawText: string | null = null;
  let staleRefreshes = 0;
  let rateLimitRetries = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!material) return [];
    const aaReq = buildAllMangaAaReq(undefined, material);
    const getUrl = `${apiUrl}?variables=${encodeURIComponent(JSON.stringify(vars))}&extensions=${encodeURIComponent(
      JSON.stringify({
        persistedQuery: { version: 1, sha256Hash: material.queryHash },
        k: material.contentLane,
        aaReq,
      }),
    )}`;

    try {
      const getRes = await providerFetch(context, getUrl, {
        signal: createTimeoutSignal(signal, 12_000),
        headers: {
          Referer: referer,
          Origin: ALLMANGA_SITE_ORIGIN,
          "User-Agent": ua,
          "x-build-id": material.buildId || ALLMANGA_BUILD_ID,
        },
      });
      rawText = getRes.ok ? await getRes.text() : null;
    } catch {
      rawText = null;
    }

    if (!rawText) return [];
    if (rawText.includes('"tobeparsed"')) break;

    // Check before the crypto/rate-limit branches: a captcha gate is neither,
    // and retrying or re-bootstrapping against it only wastes the budget.
    if (isAllMangaCaptchaResponse(rawText)) {
      throw new AllMangaCaptchaError();
    }

    if (rawText.includes("Too many requests")) {
      rateLimitRetries += 1;
      if (rateLimitRetries > 2) return [];
      rawText = null;
      await retrySleep(3_200, signal);
      continue;
    }

    if (/AA_CRYPTO_(STALE|INVALID|MISSING)/.test(rawText)) {
      staleRefreshes += 1;
      if (staleRefreshes > 2) return [];
      rawText = null;
      material = await refreshAllMangaCryptoMaterial(context, ua, signal);
      await retrySleep(400, signal);
      continue;
    }

    // Non-crypto response (e.g. plain sourceUrls JSON) — stop retrying.
    break;
  }

  if (!rawText) return [];

  let rawSources: Array<{ sourceUrl: string; sourceName: string }> = [];
  if (rawText.includes('"tobeparsed"')) {
    const blobMatch = /"tobeparsed"\s*:\s*"([^"]+)"/.exec(rawText);
    const plain = blobMatch?.[1]
      ? await decryptTobeparsedWithEpochFallback(blobMatch[1], material?.keyHex)
      : null;
    if (plain) {
      seedAllMangaEpisodeInfoFromPlaintext(showId, mode, plain);
      rawSources = extractRawSourcesFromPlaintext(plain);
    }
  } else if (!rawText.includes("AA_CRYPTO")) {
    rawSources = await extractRawSources(rawText);
  }
  const direct: StreamLink[] = [];
  const apiJobs: Promise<StreamLink[]>[] = [];
  const adapterController = new AbortController();
  const abortAdapters = () => adapterController.abort(signal?.reason);
  if (signal?.aborted) {
    abortAdapters();
  } else {
    signal?.addEventListener("abort", abortAdapters, { once: true });
  }

  for (const source of rawSources) {
    if (!acceptsSourceForLane(source.sourceName, sourceLane)) {
      continue;
    }

    let decoded: string;
    if (source.sourceUrl.startsWith("--")) {
      decoded = hexDecode(source.sourceUrl.slice(2));
    } else if (source.sourceUrl.startsWith("http://") || source.sourceUrl.startsWith("https://")) {
      decoded = source.sourceUrl;
    } else {
      continue;
    }
    if (!decoded) {
      continue;
    }

    if (isDirectStream(decoded)) {
      direct.push({
        url: decoded,
        quality: source.sourceName,
        sourceName: source.sourceName,
        referer: resolveDirectStreamReferer(decoded, referer),
      });
      continue;
    }

    // Mp4 / mp4upload embeds are full https pages (not /clock.json paths).
    // ani-cli scrapes `src: "…"` and plays with --referrer=https://www.mp4upload.com.
    if (isMp4UploadSource(source.sourceName, decoded)) {
      const sourceName = source.sourceName;
      apiJobs.push(
        fetchMp4UploadLinks(decoded, referer, ua, context, adapterController.signal)
          .then((links) =>
            links.map((link) => ({
              ...link,
              quality: link.quality || sourceName,
              sourceName: link.sourceName ?? sourceName,
            })),
          )
          .catch(() => [] as StreamLink[]),
      );
      continue;
    }

    if (!decoded.startsWith("/") || !KNOWN_SOURCES.has(source.sourceName)) {
      continue;
    }

    const sourceName = source.sourceName;
    const fetcher = sourceName === "Ak" ? fetchAkLinks : fetchStreamLinks;
    apiJobs.push(
      fetcher(decoded, referer, ua, context, adapterController.signal)
        .then((links) =>
          links.map((link) => ({
            ...link,
            quality: link.quality || sourceName,
            sourceName: link.sourceName ?? sourceName,
          })),
        )
        .catch(() => [] as StreamLink[]),
    );
  }

  const adapterWaitBudgetMs =
    sourceLane === "baseline"
      ? Math.max(0, opts.adapterWaitBudgetMs ?? ALLMANGA_BASELINE_ADAPTER_WAIT_BUDGET_MS)
      : undefined;
  const settled = await settleAllMangaAdapterJobs({
    jobs: apiJobs,
    controller: adapterController,
    waitBudgetMs: adapterWaitBudgetMs,
  });
  signal?.removeEventListener("abort", abortAdapters);
  const apiLinks = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  const result = [...direct, ...apiLinks].sort(
    (left, right) => (parseInt(right.quality) || 0) - (parseInt(left.quality) || 0),
  );
  if (result.length > 0 && result.every((link) => !link.deferredLocator)) {
    sourceCache.set(cacheKey, result);
  }
  return result;
}

async function settleAllMangaAdapterJobs({
  jobs,
  controller,
  waitBudgetMs,
}: {
  readonly jobs: readonly Promise<StreamLink[]>[];
  readonly controller: AbortController;
  readonly waitBudgetMs?: number;
}): Promise<PromiseSettledResult<StreamLink[]>[]> {
  if (jobs.length === 0) return [];

  const settled = Promise.allSettled(jobs);
  if (waitBudgetMs === 0) {
    controller.abort("baseline adapter wait budget elapsed");
    return settled;
  }
  if (waitBudgetMs === undefined) return settled;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const budgetElapsed = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitBudgetMs);
  });
  const outcome = await Promise.race([settled, budgetElapsed]);
  if (timer) clearTimeout(timer);
  if (outcome !== null) return outcome;

  controller.abort("baseline adapter wait budget elapsed");
  return settled;
}

function acceptsSourceForLane(sourceName: string, lane: AllMangaSourceLane): boolean {
  if (lane === "ak-only") return sourceName === "Ak";
  return sourceName !== "Ak";
}

export async function fetchAllMangaEpisodeCatalog(opts: {
  readonly context: ProviderRuntimeContext;
  readonly apiUrl: string;
  readonly referer: string;
  readonly ua: string;
  readonly showId: string;
  readonly mode: "sub" | "dub";
  readonly signal?: AbortSignal;
}): Promise<AllMangaEpisodeOption[]> {
  const { context, apiUrl, referer, ua, showId, mode, signal } = opts;
  const info = await loadShowCatalogInfo(context, apiUrl, referer, ua, showId, signal);
  const episodeStrings = (info.detail[mode] ?? []) as string[];

  const baseEpisodes = [...episodeStrings]
    .sort(compareEpisodeStrings)
    .map((episodeString, index) => ({
      index: index + 1,
      label: `Episode ${episodeString}`,
      providerEpisodeIdentity: {
        providerId: ALLANIME_PROVIDER_ID,
        value: episodeString,
      },
      detail: episodeString,
      totalEpisodeCount: info.episodeCount,
      externalIds: {
        anilistId: info.aniListId ? String(info.aniListId) : undefined,
        malId: info.malId ? String(info.malId) : undefined,
      },
      artwork: {
        thumbnailUrl: info.thumbnail,
      },
    }));

  const anilistId = info.aniListId ? String(info.aniListId) : undefined;
  const malId = info.malId ? String(info.malId) : undefined;
  const metadataCacheKey = allMangaEpisodeMetadataCacheKey(showId, mode);
  const metadata = new Map<number, AnimeEpisodeMetadata>();
  const seeded = getSeededEpisodeMetadata(metadataCacheKey);
  if (seeded) {
    for (const [number, meta] of seeded) metadata.set(number, meta);
  }

  const episodeCount = baseEpisodes.length;
  if (episodeCount > 0 && shouldSkipExternalEpisodeMetadataEnrichment(metadata, episodeCount)) {
    return enrichEpisodeOptionsWithAnimeMetadata(
      baseEpisodes,
      metadata,
      parseAllMangaEpisodeNumber,
    );
  }

  if (!anilistId && !malId) return baseEpisodes;

  const externalMetadata = await fetchAnimeEpisodeMetadataByNumber({ anilistId, malId }, signal);
  mergeExternalEpisodeMetadataInto(metadata, externalMetadata);

  if (metadata.size === 0) return baseEpisodes;

  return enrichEpisodeOptionsWithAnimeMetadata(baseEpisodes, metadata, parseAllMangaEpisodeNumber);
}

export async function searchAllManga(
  context: ProviderRuntimeContext,
  apiUrl: string,
  referer: string,
  ua: string,
  query: string,
  animeLang: "sub" | "dub",
  signal?: AbortSignal,
): Promise<AllMangaSearchResult[] | null> {
  const gqlQuery = `query($search:SearchInput $limit:Int $page:Int $translationType:VaildTranslationTypeEnumType $countryOrigin:VaildCountryOriginEnumType){
    shows(search:$search limit:$limit page:$page translationType:$translationType countryOrigin:$countryOrigin){
      edges{
        _id
        name
        englishName
        nativeName
        thumbnail
        banner
        description
        malId
        aniListId
        score
        averageScore
        popularity
        type
        genres
        altNames
        episodeCount
        season
        availableEpisodes
        __typename
      }
    }
  }`;
  const data = (await gqlPost(
    context,
    apiUrl,
    referer,
    ua,
    gqlQuery,
    {
      search: { allowAdult: false, allowUnknown: false, query },
      limit: 40,
      page: 1,
      translationType: animeLang,
      countryOrigin: "ALL",
    },
    signal,
  )) as {
    data: {
      shows: {
        edges: Array<{
          _id: string;
          name: string;
          englishName?: string;
          nativeName?: string;
          thumbnail?: string;
          banner?: string;
          description?: string;
          malId?: string | number | null;
          aniListId?: string | number | null;
          score?: number | null;
          averageScore?: number | null;
          popularity?: number | null;
          type?: string;
          genres?: readonly string[] | null;
          altNames?: readonly string[] | null;
          episodeCount?: string | number | null;
          season?: { year?: number | null; quarter?: string | null } | null;
          availableEpisodes: Record<string, unknown>;
        }>;
      };
    };
  } | null;

  // `gqlPost` returns null for a timeout, 429, 5xx, DNS failure, or an upstream
  // rotation. This used to coalesce to `[]`, which is the same value a healthy
  // search with no matches produces — so transport failure rendered as
  // "No results", invisible to provider health and diagnostics. Empty stays
  // empty; unreachable becomes null.
  // `gqlPost` returns null for a timeout, 429, 5xx, DNS failure, or an upstream
  // rotation. This used to coalesce to `[]`, which is the same value a healthy
  // search with no matches produces — so transport failure rendered as
  // "No results", invisible to provider health and diagnostics. Empty stays
  // empty; unreachable becomes null.
  if (data === null) return null;

  const edges = data.data?.shows?.edges ?? [];
  return edges.map((edge): AllMangaSearchResult => {
    const epRaw = edge.availableEpisodes[animeLang];
    const epCount =
      typeof epRaw === "number" ? epRaw : edge.episodeCount ? Number(edge.episodeCount) : undefined;

    // Relative thumbnails (older shows, e.g. "mcovers/...") are served from the
    // youtube-anime CDN, NOT allanime.day — which 404s. Verified host (302→301→200,
    // real WebP): wp.youtube-anime.com/aln.youtube-anime.com. Image fetch needs
    // Referer https://allmanga.to/. Newer shows already use absolute anilist.co URLs.
    let posterUrl = edge.thumbnail ?? undefined;
    if (posterUrl && !posterUrl.startsWith("http")) {
      posterUrl = `https://wp.youtube-anime.com/aln.youtube-anime.com/${posterUrl.replace(/^\//, "")}`;
    }

    const availableAudioModes = (["sub", "dub"] as const).filter((mode) => {
      const count = edge.availableEpisodes[mode];
      return typeof count === "number" && count > 0;
    });

    return {
      id: edge._id,
      title: edge.name,
      englishTitle: edge.englishName ?? undefined,
      nativeTitle: edge.nativeName ?? undefined,
      type: "series",
      year: edge.season?.year ? String(edge.season.year) : undefined,
      posterUrl: posterUrl ?? edge.banner ?? undefined,
      bannerUrl: edge.banner ?? undefined,
      malId: edge.malId ? Number(edge.malId) : undefined,
      aniListId: edge.aniListId ? Number(edge.aniListId) : undefined,
      description: edge.description ?? undefined,
      score: edge.score ?? undefined,
      averageScore: edge.averageScore ?? undefined,
      popularity: edge.popularity ?? undefined,
      genres: edge.genres ?? undefined,
      altNames: edge.altNames ?? undefined,
      epCount,
      availableAudioModes,
    };
  });
}

export async function extractRawSources(
  rawText: string,
): Promise<Array<{ sourceUrl: string; sourceName: string }>> {
  let data: {
    data?: { episode?: { sourceUrls?: Array<{ sourceUrl?: string; sourceName?: string }> } } | null;
  } | null;
  try {
    data = JSON.parse(rawText) as typeof data;
  } catch {
    // A non-JSON body (challenge page, truncation) is an empty lane, not a
    // provider-wide failure — same contract as the fetchStreamLinks/fetchAkLinks
    // catch-arms, so resolve can move on to the next candidate instead of throw.
    return [];
  }
  // Parsing is only half of it. This is a GraphQL endpoint, so a rate limit or
  // an auth failure arrives as *valid* JSON with no `data` key, and
  // `{"data":null}` is spec-legal — both of which are likelier here than an
  // HTML page. Reaching through them threw a TypeError one line past the guard,
  // on the one lane (`baseline`) with no `.catch()` above it, which skipped the
  // ak-only fallback entirely.
  // Hex-encoded `--…` paths (clock.json) and direct https embeds (Mp4 / mp4upload).
  return (data?.data?.episode?.sourceUrls ?? []).flatMap((source) => {
    const sourceUrl = source?.sourceUrl;
    if (typeof sourceUrl !== "string") return [];
    if (
      !sourceUrl.startsWith("--") &&
      !sourceUrl.startsWith("http://") &&
      !sourceUrl.startsWith("https://")
    ) {
      return [];
    }
    return [{ sourceUrl, sourceName: source?.sourceName ?? "" }];
  });
}

async function fetchStreamLinks(
  apiPath: string,
  referer: string,
  ua: string,
  context: ProviderRuntimeContext,
  signal?: AbortSignal,
): Promise<StreamLink[]> {
  const response = await providerFetch(context, `https://allanime.day${apiPath}`, {
    signal: createTimeoutSignal(signal, 15_000),
    headers: { Referer: referer, "User-Agent": ua },
  });
  if (!response.ok) {
    return [];
  }

  let body = await response.text();
  body = body.replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  const links: StreamLink[] = [];

  try {
    const parsed = JSON.parse(body) as {
      links?: Array<{ link: string; resolutionStr?: string; hls?: boolean }>;
      subtitles?: Array<{ lang: string; src: string }>;
      Referer?: string;
    };
    const m3u8Referer = parsed.Referer ?? referer;
    const subtitle = parsed.subtitles?.find((entry) =>
      entry.lang?.toLowerCase().startsWith("en"),
    )?.src;
    const allSubtitles = parsed.subtitles;

    if (parsed.links?.length) {
      for (const link of parsed.links) {
        if (!link.link) {
          continue;
        }

        if (linkIsWixmpRepackager(link.link)) {
          const base = link.link.replace(/repackager\.wixmp\.com\//g, "").replace(/\.urlset.*/, "");
          const qualityMatch = /\/,([^/]*),\/mp4/.exec(link.link);
          const variants = qualityMatch?.[1]?.split(",").filter(Boolean) ?? [];
          for (const quality of variants) {
            links.push({
              url: base.replace(/,[^/]*/, quality),
              quality,
              subtitle,
              subtitles: allSubtitles,
            });
          }
          if (variants.length === 0) {
            links.push({
              url: link.link,
              quality: link.resolutionStr ?? "",
              subtitle,
              subtitles: allSubtitles,
            });
          }
          continue;
        }

        if (linkIsMasterPlaylist(link.link)) {
          links.push(
            ...(await fetchM3u8Variants({
              context,
              url: link.link,
              referer: m3u8Referer,
              ua,
              subtitle,
              signal,
            })),
          );
          continue;
        }

        links.push({ url: link.link, quality: link.resolutionStr ?? "", subtitle });
      }
      return links;
    }
  } catch {
    // Fall through to regex fallback for ani-cli parity.
  }

  const linkPattern = /"link"\s*:\s*"([^"]+)"/;
  const resolutionPattern = /"resolutionStr"\s*:\s*"([^"]*)"/;
  for (const chunk of body.split("},{")) {
    const linkMatch = linkPattern.exec(chunk);
    if (!linkMatch?.[1]) {
      continue;
    }
    links.push({
      url: linkMatch[1],
      quality: resolutionPattern.exec(chunk)?.[1] ?? "",
    });
  }
  return links;
}

/**
 * ani-cli `get_links` mp4upload branch: scrape the embed HTML for `src: "…"`,
 * then play with referrer https://www.mp4upload.com (+ tls-verify=no at mpv).
 */
async function fetchMp4UploadLinks(
  embedUrl: string,
  siteReferer: string,
  ua: string,
  context: ProviderRuntimeContext,
  signal?: AbortSignal,
): Promise<StreamLink[]> {
  const response = await providerFetch(context, embedUrl, {
    signal: createTimeoutSignal(signal, 10_000),
    headers: { Referer: siteReferer, "User-Agent": ua },
  });
  if (!response.ok) return [];

  const html = await response.text();
  // Match ani-cli: sed -nE 's|.*src: "([^"]*)"[[:space:]]*|Mp4Upload >\1|p'
  const match = /src:\s*"([^"]+)"/.exec(html);
  const videoUrl = match?.[1]?.trim();
  if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) return [];

  return [
    {
      url: videoUrl,
      quality: "Mp4",
      sourceName: "Mp4",
      referer: MP4UPLOAD_REFERER,
      protocol: "mp4",
      container: "mp4",
    },
  ];
}

function isMp4UploadHost(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  return host === "mp4upload.com" || host.endsWith(".mp4upload.com");
}

function isMp4UploadSource(sourceName: string, decodedUrl: string): boolean {
  return sourceName === "Mp4" || isMp4UploadHost(decodedUrl);
}

function resolveDirectStreamReferer(decodedUrl: string, siteReferer: string): string | undefined {
  if (decodedUrl.includes("tools.fast4speed.rsvp")) return siteReferer;
  if (isMp4UploadHost(decodedUrl)) return MP4UPLOAD_REFERER;
  return undefined;
}

type AkRawRepresentation = {
  readonly url?: string;
  readonly link?: string;
  readonly mimeType?: string;
  readonly codecs?: string;
  readonly width?: number;
  readonly height?: number;
  readonly bandwidth?: number;
  readonly audioSamplingRate?: number;
  readonly frameRate?: string | number;
  readonly language?: string;
  readonly lang?: string;
  readonly segmentBase?: {
    readonly indexRange?: string;
    readonly Initialization?: { readonly range?: string };
    readonly initialization?: { readonly range?: string };
  };
  readonly indexRange?: string;
  readonly initRange?: string;
  readonly initialization?: { readonly range?: string } | string;
};

type AkSubtitle = {
  readonly lang?: string;
  readonly language?: string;
  readonly src?: string;
  readonly url?: string;
};

async function fetchAkLinks(
  apiPath: string,
  referer: string,
  ua: string,
  context: ProviderRuntimeContext,
  signal?: AbortSignal,
): Promise<StreamLink[]> {
  const response = await providerFetch(context, `https://allanime.day${apiPath}`, {
    signal: createTimeoutSignal(signal, 15_000),
    headers: { Referer: referer, "User-Agent": ua },
  });
  if (!response.ok) return [];

  let body = await response.text();
  body = body.replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  const payload = JSON.parse(body) as {
    links?: Array<{
      dash?: boolean;
      rawUrls?: {
        vids?: AkRawRepresentation[];
        audios?: AkRawRepresentation[];
        subtitles?: AkSubtitle[];
        duration?: number;
      };
      subtitles?: AkSubtitle[];
    }>;
    subtitles?: AkSubtitle[];
  };

  const dashLink =
    payload.links?.find((link) => link.dash && link.rawUrls) ??
    payload.links?.find((link) => link.rawUrls);
  const rawUrls = dashLink?.rawUrls;
  const video = selectAkVideo(rawUrls?.vids ?? []);
  const audio = selectAkAudio(rawUrls?.audios ?? []);
  if (!video || !audio) return [];

  const subtitles = normalizeAkSubtitles(
    rawUrls?.subtitles ?? dashLink?.subtitles ?? payload.subtitles ?? [],
  );
  const deferredLocator = registerAllMangaAkDeferredDescriptor({
    video,
    audio,
    duration: rawUrls?.duration,
  });

  return [
    {
      url: deferredLocator,
      deferredLocator,
      quality: `${video.height ?? "auto"}p`,
      referer,
      subtitles,
      subtitle: subtitles.find((subtitle) => subtitle.lang.toLowerCase().startsWith("en"))?.src,
      protocol: "dash",
      container: "mpd",
    },
  ];
}

function selectAkVideo(
  representations: readonly AkRawRepresentation[],
): AllMangaAkRepresentation | null {
  return (
    representations
      .map(normalizeAkRepresentation)
      .filter((rep): rep is AllMangaAkRepresentation => Boolean(rep?.url))
      .sort((left, right) => {
        const leftScore =
          (left.height === 1080 ? 10_000_000 : 0) +
          (left.bandwidth ?? 0) +
          (left.height ?? 0) * 1000;
        const rightScore =
          (right.height === 1080 ? 10_000_000 : 0) +
          (right.bandwidth ?? 0) +
          (right.height ?? 0) * 1000;
        return rightScore - leftScore;
      })[0] ?? null
  );
}

function selectAkAudio(
  representations: readonly AkRawRepresentation[],
): AllMangaAkRepresentation | null {
  return (
    representations
      .map(normalizeAkRepresentation)
      .filter((rep): rep is AllMangaAkRepresentation => Boolean(rep?.url))
      .sort((left, right) => (right.bandwidth ?? 0) - (left.bandwidth ?? 0))[0] ?? null
  );
}

function normalizeAkRepresentation(rep: AkRawRepresentation): AllMangaAkRepresentation | null {
  const url = rep.url ?? rep.link;
  if (!url) return null;
  return {
    url,
    mimeType: rep.mimeType,
    codecs: rep.codecs,
    width: rep.width,
    height: rep.height,
    bandwidth: rep.bandwidth,
    audioSamplingRate: rep.audioSamplingRate,
    frameRate: rep.frameRate,
    language: rep.language ?? rep.lang,
    indexRange: rep.segmentBase?.indexRange ?? rep.indexRange,
    initializationRange:
      typeof rep.initialization === "string"
        ? rep.initialization
        : (rep.segmentBase?.Initialization?.range ??
          rep.segmentBase?.initialization?.range ??
          rep.initialization?.range ??
          rep.initRange),
  };
}

function normalizeAkSubtitles(
  subtitles: readonly AkSubtitle[],
): Array<{ lang: string; src: string }> {
  return subtitles.flatMap((subtitle) => {
    const src = subtitle.src ?? subtitle.url;
    if (!src) return [];
    return [{ lang: subtitle.lang ?? subtitle.language ?? "unknown", src }];
  });
}

async function fetchM3u8Variants({
  context,
  url,
  referer,
  ua,
  subtitle,
  signal,
}: {
  readonly context: ProviderRuntimeContext;
  readonly url: string;
  readonly referer: string;
  readonly ua: string;
  readonly subtitle?: string;
  readonly signal?: AbortSignal;
}): Promise<StreamLink[]> {
  const variants = await expandHlsMasterPlaylist({
    fetch: (requestUrl: string, init?: RequestInit) =>
      providerFetch(context, requestUrl, {
        ...init,
        signal: createTimeoutSignal(signal, 15_000),
        headers: {
          Referer: referer,
          "User-Agent": ua,
          ...(init?.headers as Record<string, string> | undefined),
        },
      }),
    masterUrl: url,
    headers: { Referer: referer, "User-Agent": ua },
    signal,
  });

  return variants.map((variant) => ({
    url: variant.url,
    quality: variant.qualityLabel.replace(/p$/i, "") || variant.qualityLabel,
    referer,
    subtitle,
  }));
}

function parseHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function linkIsWixmpRepackager(link: string): boolean {
  const parsed = parseHttpUrl(link);
  return parsed !== null && parsed.hostname.toLowerCase() === "repackager.wixmp.com";
}

function linkIsMasterPlaylist(link: string): boolean {
  const parsed = parseHttpUrl(link);
  if (!parsed) {
    return false;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  return segments[segments.length - 1]?.toLowerCase() === "master.m3u8";
}

function isDirectStream(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);
  const leaf = segments[segments.length - 1]?.toLowerCase() ?? "";
  return (
    leaf.endsWith(".m3u8") ||
    leaf.endsWith(".mp4") ||
    leaf.endsWith(".mkv") ||
    host === "repackager.wixmp.com" ||
    host === "tools.fast4speed.rsvp"
  );
}

function episodeOrderValue(episodeString: string): number | null {
  const parsed = Number.parseFloat(episodeString);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareEpisodeStrings(left: string, right: string): number {
  const leftValue = episodeOrderValue(left);
  const rightValue = episodeOrderValue(right);

  if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
    return leftValue - rightValue;
  }

  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
