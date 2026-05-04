export type AllMangaSearchResult = {
  readonly id: string;
  readonly title: string;
  readonly type: "series";
  readonly year?: string;
  readonly posterUrl?: string;
  readonly epCount?: number;
};

export type AllMangaEpisodeOption = {
  readonly index: number;
  readonly label: string;
  readonly detail?: string;
};

export type AllMangaStreamData = {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly subtitle: string | null;
  readonly subtitleList: readonly string[];
  readonly subtitleSource: "provider" | "none";
  readonly subtitleEvidence: {
    readonly directSubtitleObserved?: boolean;
    readonly wyzieSearchObserved?: boolean;
    readonly reason?: "provider-default" | "not-observed";
  };
  readonly title: string;
  readonly timestamp: number;
};

export type AllMangaResolveOptions = {
  readonly animeLang: "sub" | "dub";
};

export interface AllMangaApiProvider {
  readonly kind: "api";
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly domain: string;
  readonly recommended?: boolean;
  readonly isAnimeProvider?: boolean;
  readonly searchBackend: "allmanga";
  search(
    query: string,
    opts: Pick<AllMangaResolveOptions, "animeLang">,
  ): Promise<AllMangaSearchResult[]>;
  resolveStream(
    id: string,
    type: "movie" | "series",
    season: number,
    episode: number,
    opts: AllMangaResolveOptions,
  ): Promise<AllMangaStreamData | null>;
}

export type StreamLink = {
  readonly url: string;
  readonly quality: string;
  readonly referer?: string;
  readonly subtitle?: string;
};

export type AllMangaApiProviderConfig = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly domain: string;
  readonly apiUrl: string;
  readonly referer: string;
  readonly ua?: string;
  readonly recommended?: boolean;
  readonly isAnimeProvider?: boolean;
};

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";

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

const KNOWN_SOURCES = new Set(["Default", "Yt-mp4", "S-mp4", "Luf-Mp4"]);

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
      results.push({ sourceUrl: match[1]!, sourceName: match[2]! });
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
const availableEpisodesDetailCache = new Map<
  string,
  { readonly expiresAt: number; readonly detail: Record<string, unknown[]> }
>();

function availableEpisodesDetailCacheKey(apiUrl: string, showId: string): string {
  return `${apiUrl}\n${showId}`;
}

async function loadAvailableEpisodesDetail(
  apiUrl: string,
  referer: string,
  ua: string,
  showId: string,
): Promise<Record<string, unknown[]>> {
  const key = availableEpisodesDetailCacheKey(apiUrl, showId);
  const now = Date.now();
  const hit = availableEpisodesDetailCache.get(key);
  if (hit && now < hit.expiresAt) {
    return hit.detail;
  }
  const listQuery = `query($id:String!){show(_id:$id){availableEpisodesDetail}}`;
  const listData = (await gqlPost(apiUrl, referer, ua, listQuery, { id: showId })) as {
    data: { show: { availableEpisodesDetail: Record<string, unknown[]> } };
  };
  const detail = listData.data.show.availableEpisodesDetail;
  availableEpisodesDetailCache.set(key, {
    expiresAt: now + AVAILABLE_EPISODES_DETAIL_TTL_MS,
    detail,
  });
  return detail;
}

export async function gqlPost(
  apiUrl: string,
  referer: string,
  ua: string,
  query: string,
  vars: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Referer: referer, "User-Agent": ua },
    body: JSON.stringify({ query, variables: vars }),
  });
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${apiUrl}`);
  }
  return response.json();
}

export async function gqlRaw(
  apiUrl: string,
  referer: string,
  ua: string,
  query: string,
  vars: Record<string, unknown>,
): Promise<string> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Referer: referer, "User-Agent": ua },
    body: JSON.stringify({ query, variables: vars }),
  });
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${apiUrl}`);
  }
  return response.text();
}

export async function resolveEpisodeSources(opts: {
  readonly apiUrl: string;
  readonly referer: string;
  readonly ua: string;
  readonly showId: string;
  readonly epStr: string;
  readonly mode: "sub" | "dub";
}): Promise<StreamLink[]> {
  const { apiUrl, referer, ua, showId, epStr, mode } = opts;
  const query = `query($showId:String! $translationType:VaildTranslationTypeEnumType! $episodeString:String!){
    episode(showId:$showId translationType:$translationType episodeString:$episodeString){
      episodeString sourceUrls
    }
  }`;

  const rawText = await gqlRaw(apiUrl, referer, ua, query, {
    showId,
    translationType: mode,
    episodeString: epStr,
  });

  const rawSources = await extractRawSources(rawText);
  const direct: StreamLink[] = [];
  const apiJobs: Promise<StreamLink[]>[] = [];

  for (const source of rawSources) {
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
    apiJobs.push(
      fetchStreamLinks(decoded, referer, ua)
        .then((links) => links.map((link) => ({ ...link, quality: link.quality || sourceName })))
        .catch(() => [] as StreamLink[]),
    );
  }

  const settled = await Promise.allSettled(apiJobs);
  const apiLinks = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  return [...direct, ...apiLinks].sort(
    (left, right) => (parseInt(right.quality) || 0) - (parseInt(left.quality) || 0),
  );
}

export async function fetchAllMangaEpisodeCatalog(opts: {
  readonly apiUrl: string;
  readonly referer: string;
  readonly ua: string;
  readonly showId: string;
  readonly mode: "sub" | "dub";
}): Promise<AllMangaEpisodeOption[]> {
  const { apiUrl, referer, ua, showId, mode } = opts;
  const detail = await loadAvailableEpisodesDetail(apiUrl, referer, ua, showId);
  const episodeStrings = (detail[mode] ?? []) as string[];

  return [...episodeStrings].sort(compareEpisodeStrings).map((episodeString, index) => ({
    index: index + 1,
    label: `Episode ${episodeString}`,
    detail: `Source episode ${episodeString}`,
  }));
}

export function createAllMangaApiProvider(cfg: AllMangaApiProviderConfig): AllMangaApiProvider {
  const ua = cfg.ua ?? DEFAULT_UA;

  return {
    kind: "api",
    searchBackend: "allmanga",
    id: cfg.id,
    name: cfg.name,
    description: cfg.description,
    domain: cfg.domain,
    recommended: cfg.recommended,
    isAnimeProvider: cfg.isAnimeProvider,

    async search(query, opts) {
      const gqlQuery = `query($search:SearchInput $limit:Int $page:Int $translationType:VaildTranslationTypeEnumType $countryOrigin:VaildCountryOriginEnumType){
        shows(search:$search limit:$limit page:$page translationType:$translationType countryOrigin:$countryOrigin){
          edges{_id name availableEpisodes __typename}
        }
      }`;
      const data = (await gqlPost(cfg.apiUrl, cfg.referer, ua, gqlQuery, {
        search: { allowAdult: false, allowUnknown: false, query },
        limit: 40,
        page: 1,
        translationType: opts.animeLang,
        countryOrigin: "ALL",
      })) as {
        data: {
          shows: {
            edges: Array<{ _id: string; name: string; availableEpisodes: Record<string, unknown> }>;
          };
        };
      };

      return data.data.shows.edges.map((edge): AllMangaSearchResult => {
        const epRaw = edge.availableEpisodes[opts.animeLang];
        const epCount = typeof epRaw === "number" ? epRaw : undefined;
        return { id: edge._id, title: edge.name, type: "series", epCount };
      });
    },

    async resolveStream(id, _type, _season, episode, opts) {
      try {
        const detail = await loadAvailableEpisodesDetail(cfg.apiUrl, cfg.referer, ua, id);
        const episodes = (detail[opts.animeLang] ?? []) as string[];
        const epStr = resolveAnimeEpisodeString(episodes, episode);
        const links = await resolveEpisodeSources({
          apiUrl: cfg.apiUrl,
          referer: cfg.referer,
          ua,
          showId: id,
          epStr,
          mode: opts.animeLang,
        });

        const best =
          links.find((link) => link.url.includes("master.m3u8")) ??
          [...links].sort(
            (left, right) => (parseInt(right.quality) || 0) - (parseInt(left.quality) || 0),
          )[0];

        if (!best) {
          return null;
        }

        return {
          url: best.url,
          headers: buildStreamHeaders(best.referer, cfg.referer, ua),
          subtitle: best.subtitle ?? null,
          subtitleList: best.subtitle ? [best.subtitle] : [],
          subtitleSource: best.subtitle ? "provider" : "none",
          subtitleEvidence: {
            directSubtitleObserved: false,
            wyzieSearchObserved: false,
            reason: best.subtitle ? "provider-default" : "not-observed",
          },
          title: "",
          timestamp: Date.now(),
        };
      } catch {
        return null;
      }
    },
  };
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
): Promise<StreamLink[]> {
  const response = await fetch(`https://allanime.day${apiPath}`, {
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

    if (parsed.links?.length) {
      for (const link of parsed.links) {
        if (!link.link) {
          continue;
        }

        if (link.link.includes("repackager.wixmp.com")) {
          const base = link.link.replace(/repackager\.wixmp\.com\//g, "").replace(/\.urlset.*/, "");
          const qualityMatch = /\/,([^/]*),\/mp4/.exec(link.link);
          const variants = qualityMatch?.[1]?.split(",").filter(Boolean) ?? [];
          for (const quality of variants) {
            links.push({
              url: base.replace(/,[^/]*/, quality),
              quality,
              subtitle,
            });
          }
          if (variants.length === 0) {
            links.push({ url: link.link, quality: link.resolutionStr ?? "", subtitle });
          }
          continue;
        }

        if (link.link.includes("master.m3u8")) {
          links.push(
            ...(await fetchM3u8Variants({
              url: link.link,
              referer: m3u8Referer,
              ua,
              subtitle,
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

async function fetchM3u8Variants({
  url,
  referer,
  ua,
  subtitle,
}: {
  readonly url: string;
  readonly referer: string;
  readonly ua: string;
  readonly subtitle?: string;
}): Promise<StreamLink[]> {
  const response = await fetch(url, {
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

function isDirectStream(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes(".m3u8") ||
    lower.includes(".mp4") ||
    lower.includes(".mkv") ||
    lower.includes("repackager.wixmp.com") ||
    lower.includes("tools.fast4speed.rsvp")
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
