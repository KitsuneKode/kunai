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

const ALLMANGA_KEY_RAW = "Xot36i3lK3:v1";

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

const KNOWN_SOURCES = new Set(["Default", "Yt-mp4", "S-mp4", "Luf-Mp4", "Fm-mp4", "Ak"]);
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
): Promise<Array<{ sourceName: string; sourceUrl: string }>> {
  try {
    const raw = Uint8Array.from(atob(blob), (char) => char.charCodeAt(0));
    const iv = raw.slice(1, 13);
    const data = raw.slice(13, Math.max(13, raw.length - 16));
    const counter = new Uint8Array(16);
    counter.set(iv, 0);
    counter[15] = 2;

    const key = await deriveAllMangaKey();
    const plain = await crypto.subtle.decrypt({ name: "AES-CTR", counter, length: 64 }, key, data);
    const text = new TextDecoder().decode(plain);
    const results: Array<{ sourceName: string; sourceUrl: string }> = [];
    const pattern = /"sourceUrl"\s*:\s*"--([^"]+)"[^}]*"sourceName"\s*:\s*"([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const [, sourceUrl, sourceName] = match;
      if (sourceUrl && sourceName) {
        results.push({ sourceUrl, sourceName });
      }
    }
    return results;
  } catch {
    return [];
  }
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
  apiUrl: string,
  referer: string,
  ua: string,
  showId: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown[]>> {
  const info = await loadShowCatalogInfo(apiUrl, referer, ua, showId, signal);
  return info.detail;
}

/** Fetch show metadata + episode detail in one GraphQL call. */
export async function loadShowCatalogInfo(
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

  let data = (await gqlPost(apiUrl, referer, ua, query, { id: showId }, signal)) as
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
      apiUrl,
      "https://youtu-chan.com",
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
    thumbnail: show?.thumbnail ?? undefined,
  };

  showCatalogCache.set(cacheKey, info);
  return info;
}

export async function gqlPost(
  apiUrl: string,
  referer: string,
  ua: string,
  query: string,
  vars: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown | null> {
  try {
    const response = await fetch(apiUrl, {
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
  apiUrl: string,
  referer: string,
  ua: string,
  query: string,
  vars: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const response = await fetch(apiUrl, {
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
  readonly apiUrl: string;
  readonly referer: string;
  readonly ua: string;
  readonly showId: string;
  readonly epStr: string;
  readonly mode: "sub" | "dub";
  readonly sourceLane?: AllMangaSourceLane;
  readonly signal?: AbortSignal;
}): Promise<StreamLink[]> {
  const { apiUrl, referer, ua, showId, epStr, mode, signal } = opts;
  const sourceLane = opts.sourceLane ?? "baseline";

  // Check source cache (episode string + mode → StreamLink[])
  const cacheKey = `${showId}:${epStr}:${mode}:${sourceLane}`;
  const cached = sourceCache.get(cacheKey);
  if (cached) return cached;

  const query = `query($showId:String! $translationType:VaildTranslationTypeEnumType! $episodeString:String!){
    episode(showId:$showId translationType:$translationType episodeString:$episodeString){
      episodeString sourceUrls
    }
  }`;

  // Two-tier request matching ani-cli commit 6803b8a:
  //   Tier 1 — GET with persisted query hash + youtu-chan.com Origin
  //   Tier 2 — POST fallback with caller-provided referer
  const queryHash = "d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec";
  const vars = { showId, translationType: mode, episodeString: epStr };
  const getUrl = `${apiUrl}?variables=${encodeURIComponent(JSON.stringify(vars))}&extensions=${encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: queryHash } }))}`;

  let rawText: string | null = null;

  try {
    const getRes = await fetch(getUrl, {
      signal: createTimeoutSignal(signal, 12_000),
      headers: {
        Referer: "https://youtu-chan.com",
        Origin: "https://youtu-chan.com",
        "User-Agent": ua,
      },
    });
    if (getRes.ok) rawText = await getRes.text();
  } catch {}

  if (!rawText || !rawText.includes('"tobeparsed"')) {
    try {
      const postRes = await fetch(apiUrl, {
        method: "POST",
        signal: createTimeoutSignal(signal, 15_000),
        headers: {
          "Content-Type": "application/json",
          Referer: referer,
          "User-Agent": ua,
        },
        body: JSON.stringify({ query, variables: vars }),
      });
      if (postRes.ok) rawText = await postRes.text();
    } catch {}
  }

  if (!rawText) return [];

  const rawSources = await extractRawSources(rawText);
  const direct: StreamLink[] = [];
  const apiJobs: Promise<StreamLink[]>[] = [];

  for (const source of rawSources) {
    if (!acceptsSourceForLane(source.sourceName, sourceLane)) {
      continue;
    }

    const raw = source.sourceUrl.startsWith("--") ? source.sourceUrl.slice(2) : source.sourceUrl;
    const decoded = hexDecode(raw);
    if (!decoded) {
      continue;
    }

    if (isDirectStream(decoded)) {
      direct.push({
        url: decoded,
        quality: source.sourceName,
        referer: decoded.includes("tools.fast4speed.rsvp") ? referer : undefined,
      });
      continue;
    }

    if (!decoded.startsWith("/") || !KNOWN_SOURCES.has(source.sourceName)) {
      continue;
    }

    const sourceName = source.sourceName;
    const fetcher =
      sourceName === "Fm-mp4"
        ? fetchFilemoonLinks
        : sourceName === "Ak"
          ? fetchAkLinks
          : fetchStreamLinks;
    apiJobs.push(
      fetcher(decoded, referer, ua, signal)
        .then((links) => links.map((link) => ({ ...link, quality: link.quality || sourceName })))
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
  readonly apiUrl: string;
  readonly referer: string;
  readonly ua: string;
  readonly showId: string;
  readonly mode: "sub" | "dub";
  readonly signal?: AbortSignal;
}): Promise<AllMangaEpisodeOption[]> {
  const { apiUrl, referer, ua, showId, mode, signal } = opts;
  const info = await loadShowCatalogInfo(apiUrl, referer, ua, showId, signal);
  const episodeStrings = (info.detail[mode] ?? []) as string[];

  return [...episodeStrings].sort(compareEpisodeStrings).map((episodeString, index) => ({
    index: index + 1,
    label: `Episode ${episodeString}`,
    detail: `Source episode ${episodeString}`,
    totalEpisodeCount: info.episodeCount,
    externalIds: {
      anilistId: info.aniListId ? String(info.aniListId) : undefined,
      malId: info.malId ? String(info.malId) : undefined,
    },
    artwork: {
      thumbnailUrl: info.thumbnail,
    },
  }));
}

export async function searchAllManga(
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

async function deriveAllMangaKey(): Promise<CryptoKey> {
  const keyBytes = new TextEncoder().encode(ALLMANGA_KEY_RAW);
  const hashBuf = await crypto.subtle.digest("SHA-256", keyBytes);
  return crypto.subtle.importKey("raw", hashBuf, { name: "AES-CTR" }, false, ["decrypt"]);
}

async function extractRawSources(
  rawText: string,
): Promise<Array<{ sourceUrl: string; sourceName: string }>> {
  if (rawText.includes('"tobeparsed"')) {
    const blobMatch = /"tobeparsed"\s*:\s*"([^"]+)"/.exec(rawText);
    return blobMatch?.[1] ? decodeTobeparsed(blobMatch[1]) : [];
  }

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
  signal?: AbortSignal,
): Promise<StreamLink[]> {
  const response = await fetch(`https://allanime.day${apiPath}`, {
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
  signal?: AbortSignal,
): Promise<StreamLink[]> {
  const response = await fetch(`https://allanime.day${apiPath}`, {
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
  url,
  referer,
  ua,
  subtitle,
  signal,
}: {
  readonly url: string;
  readonly referer: string;
  readonly ua: string;
  readonly subtitle?: string;
  readonly signal?: AbortSignal;
}): Promise<StreamLink[]> {
  const response = await fetch(url, {
    signal: createTimeoutSignal(signal, 15_000),
    headers: { Referer: referer, "User-Agent": ua },
  });
  if (!response.ok) {
    return [];
  }

  const m3u = await response.text();
  const urlOf = new URL(url);
  const base = `${urlOf.protocol}//${urlOf.host}${urlOf.pathname.replace(/[^/]*$/, "")}`;
  const links: StreamLink[] = [];
  const streamPattern = /RESOLUTION=\d+x(\d+)[^\n]*\n([^\n]+)/g;
  let streamMatch: RegExpExecArray | null;
  while ((streamMatch = streamPattern.exec(m3u)) !== null) {
    const quality = streamMatch[1] ?? "unknown";
    const href = streamMatch[2]?.trim() ?? "";
    if (!href || href.startsWith("#")) {
      continue;
    }
    links.push({
      url: href.startsWith("http") ? href : base + href,
      quality,
      referer,
      subtitle,
    });
  }
  return links;
}

function base64urlToBytes(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function fetchFilemoonLinks(
  apiPath: string,
  referer: string,
  ua: string,
  signal?: AbortSignal,
): Promise<StreamLink[]> {
  try {
    const res = await fetch(`https://allanime.day${apiPath}`, {
      signal: createTimeoutSignal(signal, 15_000),
      headers: { Referer: referer, "User-Agent": ua },
    });
    if (!res.ok) return [];

    const parsed = (await res.json()) as {
      iv: string;
      payload: string;
      key_parts: [string, string];
    };

    const iv = base64urlToBytes(parsed.iv);
    const kp1 = base64urlToBytes(parsed.key_parts[0]);
    const kp2 = base64urlToBytes(parsed.key_parts[1]);
    const keyBytes = new Uint8Array(kp1.length + kp2.length);
    keyBytes.set(kp1, 0);
    keyBytes.set(kp2, kp1.length);

    const counter = new Uint8Array(16);
    counter.set(iv, 0);
    counter[15] = 2;

    const rawPayload = base64urlToBytes(parsed.payload);
    const data = rawPayload.slice(0, Math.max(0, rawPayload.length - 16));

    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CTR" }, false, [
      "decrypt",
    ]);
    const plain = await crypto.subtle.decrypt({ name: "AES-CTR", counter, length: 64 }, key, data);
    const text = new TextDecoder().decode(plain);
    const results: StreamLink[] = [];
    const pattern = /"url"\s*:\s*"([^"]+)"[^}]*"height"\s*:\s*(\d+)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const url = match[1];
      const height = match[2];
      if (!url || !height) continue;
      results.push({
        url: url.replace(/\\u0026/g, "&").replace(/\\u003D/g, "="),
        quality: height,
      });
    }
    return results;
  } catch {
    return [];
  }
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
