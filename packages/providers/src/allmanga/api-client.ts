import { createCipheriv, createDecipheriv, createHash } from "node:crypto";

import type { ProviderRuntimeContext } from "@kunai/types";

import { providerFetch } from "../runtime/fetch";
import {
  allMangaEpisodeMetadataCacheKey,
  enrichEpisodeOptionsWithAnimeMetadata,
  fetchAnimeEpisodeMetadataByNumber,
  getSeededEpisodeMetadata,
  parseAllMangaEpisodeNumber,
  seedEpisodeMetadataFromProvider,
  shouldSkipExternalEpisodeMetadataEnrichment,
  type AnimeEpisodeMetadata,
} from "../shared/anime-metadata";
import { expandHlsMasterPlaylist } from "../shared/hls-ladder";
import { TTLCache } from "../shared/provider-cache";

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
 * AllAnime crypto — aligned with ani-cli master `72d7f72` ("Add AES-256-GCM
 * encryption", 2026-07-23). Upstream now derives the key at runtime
 * (`fetch_keys`): scrape `mkissa.to` for `epoch` + base64 `partB` + the app JS
 * URL, download the first JS chunks from `cdn.mkissa.net`, take the first
 * 64-hex mask, and XOR mask with partB. `getAllMangaCryptoMaterial` ports that
 * flow; the bundled constants below are only a fallback when the scrape fails.
 *
 * Scheme notes:
 * - `tobeparsed` is AES-256-GCM (was AES-256-CTR): base64(0x01 || iv12 || ct || tag16).
 * - `aaReq` carries no buildId anymore (IV string is `epoch:qh:ts`) and the
 *   `x-build-id` header is gone.
 * - API base moved to `api.mkissa.net` with Referer/Origin `https://mkissa.to`.
 * - The API rate-limits bursts ("try again in 3 seconds"), so stale-material
 *   retries refetch keys instead of storming the endpoint.
 *
 * Bundled material last derived: 2026-07-24 (epoch 6885, ani-cli 72d7f72).
 */
export const ALLMANGA_KEY_HEX = "ff102360a5065bb72fc128f7efa5042dbf4db582e5c58754078265926a76bfd8";
export const ALLMANGA_QUERY_HASH =
  "f4662f4b7510b26795dd53ef824a0bf1740fbbc5d1273fab18222ac831bca8d0";
/** Upstream clock bucket fallback; the live value is scraped from mkissa.to. */
export const ALLMANGA_EPOCH = 6885;

/** Site page that carries the epoch + partB + app-JS pointer (ani-cli `allanime_refr`). */
const ALLMANGA_SITE_URL = "https://mkissa.to";
/** SvelteKit immutable asset base that hosts the app JS with the key mask. */
const ALLMANGA_CDN_IMMUTABLE_BASE = "https://cdn.mkissa.net/all/mk/_app/immutable";
/** How long derived crypto material stays trusted before a lazy refetch. */
const ALLMANGA_CRYPTO_MATERIAL_TTL_MS = 6 * 60 * 60 * 1000;

export type AllMangaCryptoMaterial = {
  readonly keyHex: string;
  readonly epoch: number;
  readonly queryHash: string;
};

/** Last-known-good material, used only when the live scrape fails. */
export const BUNDLED_ALLMANGA_CRYPTO: AllMangaCryptoMaterial = {
  keyHex: ALLMANGA_KEY_HEX,
  epoch: ALLMANGA_EPOCH,
  queryHash: ALLMANGA_QUERY_HASH,
};

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
const KNOWN_SOURCES = new Set(["Default", "Yt-mp4", "S-mp4", "Luf-Mp4", "Ak"]);
const akDeferredRegistry = new Map<string, AllMangaAkDeferredDescriptor>();
let akDeferredCounter = 0;

export function registerAllMangaAkDeferredDescriptor(
  descriptor: AllMangaAkDeferredDescriptor,
): string {
  akDeferredCounter += 1;
  const locator = `allmanga-ak:${Date.now().toString(36)}-${akDeferredCounter.toString(36)}`;
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
 * Build the AllAnime `aaReq` attestation (ani-cli `get_aa_req`).
 * Layout: base64(0x01 || iv12 || ciphertext || gcmTag16)
 * where iv = SHA-256(`${epoch}:${qh}:${ts}`)[0:12]
 * and plaintext is `{"v":1,"ts","epoch","qh"}` encrypted with AES-256-GCM.
 */
export function buildAllMangaAaReq(
  nowMs: number = Date.now(),
  material: AllMangaCryptoMaterial = BUNDLED_ALLMANGA_CRYPTO,
): string {
  const ts = Math.floor(nowMs / 300_000) * 300_000;
  const payloadIv = `${material.epoch}:${material.queryHash}:${ts}`;
  const payload = JSON.stringify({
    v: 1,
    ts,
    epoch: material.epoch,
    qh: material.queryHash,
  });
  const iv = createHash("sha256").update(payloadIv).digest().subarray(0, 12);
  const key = Buffer.from(material.keyHex, "hex");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, ciphertext, tag]).toString("base64");
}

let cachedCryptoMaterial: { readonly material: AllMangaCryptoMaterial; expiresAt: number } | null =
  null;
let inFlightCryptoMaterial: Promise<AllMangaCryptoMaterial | null> | null = null;
let cryptoMaterialOverrideForTest: AllMangaCryptoMaterial | null = null;
let retrySleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms);

export function setAllMangaCryptoMaterialForTest(material: AllMangaCryptoMaterial | null): void {
  cryptoMaterialOverrideForTest = material;
}

export function setAllMangaRetrySleepForTest(sleep: ((ms: number) => Promise<void>) | null): void {
  retrySleep = sleep ?? ((ms) => Bun.sleep(ms));
}

/**
 * Crypto material for the episode persisted query: cached when fresh, derived
 * live otherwise (ani-cli `fetch_keys`). Falls back to the bundled material
 * when the scrape fails so resolve degrades to a plain AA_CRYPTO_* miss
 * instead of a hard error.
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
        // A failed scrape falls back to bundled material; retry the scrape
        // sooner than the normal TTL in that case.
        expiresAt: Date.now() + (material ? ALLMANGA_CRYPTO_MATERIAL_TTL_MS : 60_000),
      };
      return resolved;
    })
    .finally(() => {
      inFlightCryptoMaterial = null;
    });
  return inFlightCryptoMaterial;
}

/** Port of ani-cli `fetch_keys`: key = first-64-hex-in-JS-chunks XOR base64(partB). */
async function fetchAllMangaCryptoMaterial(
  context: ProviderRuntimeContext,
  ua: string,
  signal?: AbortSignal,
): Promise<AllMangaCryptoMaterial | null> {
  try {
    const pageRes = await providerFetch(context, ALLMANGA_SITE_URL, {
      signal: createTimeoutSignal(signal, 12_000),
      headers: { "User-Agent": ua },
    });
    if (!pageRes.ok) return null;
    const page = await pageRes.text();

    const epoch = Number(/"epoch":(\d+)/.exec(page)?.[1]);
    const partB = /"partB":"([^"]*)"/.exec(page)?.[1];
    const appUrl = new RegExp(
      `${ALLMANGA_CDN_IMMUTABLE_BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/entry/app\\.[A-Za-z0-9_.-]+\\.js`,
    ).exec(page)?.[0];
    if (!Number.isFinite(epoch) || epoch <= 0 || !partB || !appUrl) return null;

    const appRes = await providerFetch(context, appUrl, {
      signal: createTimeoutSignal(signal, 12_000),
      headers: { "User-Agent": ua },
    });
    if (!appRes.ok) return null;
    const appJs = await appRes.text();

    const chunkPaths = [...appJs.matchAll(/"\.\.\/(chunks\/[A-Za-z0-9_.-]+\.js)"/g)]
      .map((match) => match[1])
      .filter((path): path is string => Boolean(path))
      .slice(0, 5);
    if (chunkPaths.length === 0) return null;

    const chunkBodies = await Promise.all(
      chunkPaths.map(async (path) => {
        try {
          const res = await providerFetch(context, `${ALLMANGA_CDN_IMMUTABLE_BASE}/${path}`, {
            signal: createTimeoutSignal(signal, 12_000),
            headers: { "User-Agent": ua },
          });
          return res.ok ? await res.text() : "";
        } catch {
          return "";
        }
      }),
    );

    let maskHex: string | undefined;
    for (const body of chunkBodies) {
      maskHex = /[0-9a-f]{64}/.exec(body)?.[0];
      if (maskHex) break;
    }
    if (!maskHex) return null;

    const partBytes = Buffer.from(partB, "base64");
    const maskBytes = Buffer.from(maskHex, "hex");
    if (partBytes.length !== 32 || maskBytes.length !== 32) return null;
    const key = Buffer.alloc(32);
    for (let index = 0; index < 32; index += 1) {
      key[index] = (maskBytes[index] ?? 0) ^ (partBytes[index] ?? 0);
    }
    return { keyHex: key.toString("hex"), epoch, queryHash: ALLMANGA_QUERY_HASH };
  } catch {
    return null;
  }
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
  return exact ?? episodeStrings[requestedEpisode - 1] ?? String(requestedEpisode);
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
const showCatalogCache = new TTLCache<string, ShowCatalogInfo>(AVAILABLE_EPISODES_DETAIL_TTL_MS);

/** Cache source resolve results per show+episode+mode. TTL 5 minutes. */
const sourceCache = new TTLCache<string, StreamLink[]>(300_000);

export function clearAllMangaProviderCachesForTest(): void {
  showCatalogCache.clear();
  sourceCache.clear();
  akDeferredRegistry.clear();
  cachedCryptoMaterial = null;
  cryptoMaterialOverrideForTest = null;
  retrySleep = (ms) => Bun.sleep(ms);
}

type AbortSignalConstructorWithAny = typeof AbortSignal & {
  readonly any?: (signals: readonly AbortSignal[]) => AbortSignal;
};

function createTimeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  const abortSignal = AbortSignal as AbortSignalConstructorWithAny;
  if (abortSignal.any) return abortSignal.any([signal, timeoutSignal]);

  const controller = new AbortController();
  const abort = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  if (signal.aborted) abort(signal);
  if (timeoutSignal.aborted) abort(timeoutSignal);
  signal.addEventListener("abort", () => abort(signal), { once: true });
  timeoutSignal.addEventListener("abort", () => abort(timeoutSignal), { once: true });
  return controller.signal;
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

export async function resolveEpisodeSources(opts: {
  readonly context: ProviderRuntimeContext;
  readonly apiUrl: string;
  readonly referer: string;
  readonly ua: string;
  readonly showId: string;
  readonly epStr: string;
  readonly mode: "sub" | "dub";
  readonly sourceLane?: AllMangaSourceLane;
  readonly signal?: AbortSignal;
}): Promise<StreamLink[]> {
  const { context, apiUrl, referer, ua, showId, epStr, mode, signal } = opts;
  const sourceLane = opts.sourceLane ?? "baseline";

  // Check source cache (episode string + mode → StreamLink[])
  const cacheKey = `${showId}:${epStr}:${mode}:${sourceLane}`;
  const cached = sourceCache.get(cacheKey);
  if (cached) return cached;

  // GET with persisted query + aaReq attestation (ani-cli master 72d7f72).
  // Without aaReq the API returns AA_CRYPTO_MISSING; a rotated key/epoch
  // returns AA_CRYPTO_STALE/INVALID — recover by re-deriving the key from the
  // site instead of storming the API (which rate-limits bursts for ~3s).
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
        aaReq,
      }),
    )}`;

    try {
      const getRes = await providerFetch(context, getUrl, {
        signal: createTimeoutSignal(signal, 12_000),
        headers: {
          Referer: referer,
          Origin: "https://mkissa.to",
          "User-Agent": ua,
        },
      });
      rawText = getRes.ok ? await getRes.text() : null;
    } catch {
      rawText = null;
    }

    if (!rawText) return [];
    if (rawText.includes('"tobeparsed"')) break;

    if (rawText.includes("Too many requests")) {
      rateLimitRetries += 1;
      if (rateLimitRetries > 2) return [];
      rawText = null;
      await retrySleep(3_200);
      continue;
    }

    if (/AA_CRYPTO_(STALE|INVALID|MISSING)/.test(rawText)) {
      staleRefreshes += 1;
      if (staleRefreshes > 2) return [];
      rawText = null;
      material = await refreshAllMangaCryptoMaterial(context, ua, signal);
      await retrySleep(400);
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
      ? await decryptTobeparsedPlaintext(blobMatch[1], material?.keyHex)
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
        referer: decoded.includes("tools.fast4speed.rsvp") ? referer : undefined,
      });
      continue;
    }

    if (!decoded.startsWith("/") || !KNOWN_SOURCES.has(source.sourceName)) {
      continue;
    }

    const sourceName = source.sourceName;
    const fetcher = sourceName === "Ak" ? fetchAkLinks : fetchStreamLinks;
    apiJobs.push(
      fetcher(decoded, referer, ua, context, signal)
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

  const settled = await Promise.allSettled(apiJobs);
  const apiLinks = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  const result = [...direct, ...apiLinks].sort(
    (left, right) => (parseInt(right.quality) || 0) - (parseInt(left.quality) || 0),
  );
  if (result.length > 0) sourceCache.set(cacheKey, result);
  return result;
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
  for (const [number, meta] of externalMetadata) {
    const existing = metadata.get(number);
    if (!existing) {
      metadata.set(number, meta);
      continue;
    }
    metadata.set(number, {
      number,
      title: existing.title ?? meta.title,
      synopsis: existing.synopsis ?? meta.synopsis,
      airDate: existing.airDate ?? meta.airDate,
      thumbnail: existing.thumbnail ?? meta.thumbnail,
      isFiller: existing.isFiller ?? meta.isFiller,
      isRecap: existing.isRecap ?? meta.isRecap,
      source: "merged",
    });
  }

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
): Promise<AllMangaSearchResult[]> {
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

  const edges = data?.data?.shows?.edges ?? [];
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

async function extractRawSources(
  rawText: string,
): Promise<Array<{ sourceUrl: string; sourceName: string }>> {
  const data = JSON.parse(rawText) as {
    data: { episode: { sourceUrls?: Array<{ sourceUrl: string; sourceName: string }> } };
  };
  return (data.data.episode?.sourceUrls ?? []).filter((source) =>
    source.sourceUrl.startsWith("--"),
  );
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
