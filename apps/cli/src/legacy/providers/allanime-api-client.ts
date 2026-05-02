// =============================================================================
// AllAnime API client — reusable AllAnime / AllManga-inspired GraphQL client
//
// Providers that deliberately target the allanime.day API family share:
//   • GraphQL endpoint, Referer header, User-Agent
//   • Hex-decode cipher (ported from ani-cli provider_init)
//   • tobeparsed AES-256-CTR decryption (ported from ani-cli decode_tobeparsed)
//   • get_links resolution (wixmp, m3u8 master, direct mp4)
//
// To add a new anime provider that uses this API:
//   1. Create src/providers/myprovider.ts
//   2. Import createAllAnimeApiProvider and call it with your config.
//   3. Register in src/providers/index.ts — one line.
//
// Nothing else needs to change.
// =============================================================================

import type { EpisodePickerOption } from "@/domain/types";
import { dbg, dbgErr } from "@/logger";
import type { StreamData } from "@/scraper";

// ── Legacy Adapter Types (retained for this API client) ────────────────────────

export type ApiSearchResult = {
  id: string;
  title: string;
  type: "movie" | "series";
  year?: string;
  posterUrl?: string;
  epCount?: number;
};

export type EmbedScraperOpts = { needsClick?: boolean };

export type ResolveOpts = {
  subLang: string;
  animeLang: "sub" | "dub";
  embedScraper: (embedUrl: string, opts?: EmbedScraperOpts) => Promise<StreamData | null>;
};

export interface ApiProvider {
  kind: "api";
  id: string;
  name: string;
  description: string;
  domain: string;
  recommended?: boolean;
  isAnimeProvider?: boolean;
  searchBackend: "allanime";
  search(query: string, opts: Pick<ResolveOpts, "animeLang">): Promise<ApiSearchResult[]>;
  resolveStream(
    id: string,
    type: "movie" | "series",
    season: number,
    episode: number,
    opts: ResolveOpts,
  ): Promise<StreamData | null>;
}

// ── Hex-decode cipher (ani-cli provider_init) ─────────────────────────────────

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

export function hexDecode(encoded: string): string {
  let out = "";
  for (let i = 0; i + 1 < encoded.length; i += 2) {
    const pair = encoded.slice(i, i + 2);
    out += HEX[pair] ?? pair;
  }
  return out.replace(/\/clock\b/g, "/clock.json");
}

// ── AES-256-CTR decryption (ani-cli decode_tobeparsed) ───────────────────────
//
// ani-cli: current blob layout = 1-byte version prefix + 12-byte IV +
// encrypted body + 16-byte footer/tag.
// AES-CTR counter remains IV + "00000002", but only the encrypted body is
// decrypted; the footer bytes must not be fed into the cipher.
//
// This handles the "tobeparsed" field that the API returns for some episodes
// instead of the normal sourceUrls array.

const ALLANIME_KEY_RAW = "Xot36i3lK3:v1";

async function deriveKey(): Promise<CryptoKey> {
  const keyBytes = new TextEncoder().encode(ALLANIME_KEY_RAW);
  const hashBuf = await crypto.subtle.digest("SHA-256", keyBytes);
  return crypto.subtle.importKey("raw", hashBuf, { name: "AES-CTR" }, false, ["decrypt"]);
}

export async function decodeTobeparsed(
  blob: string,
): Promise<Array<{ sourceName: string; sourceUrl: string }>> {
  try {
    const raw = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
    const iv = raw.slice(1, 13);
    const data = raw.slice(13, Math.max(13, raw.length - 16));

    // AES-CTR counter: IV bytes + 32-bit counter = 2
    const ctr = new Uint8Array(16);
    ctr.set(iv, 0);
    ctr[12] = 0;
    ctr[13] = 0;
    ctr[14] = 0;
    ctr[15] = 2;

    const key = await deriveKey();
    const plain = await crypto.subtle.decrypt(
      { name: "AES-CTR", counter: ctr, length: 64 },
      key,
      data,
    );
    const text = new TextDecoder().decode(plain);

    // Parse JSON-like chunks: {"sourceUrl":"--<hex>","sourceName":"<name>"}
    const results: Array<{ sourceName: string; sourceUrl: string }> = [];
    const re = /"sourceUrl"\s*:\s*"--([^"]+)"[^}]*"sourceName"\s*:\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      results.push({ sourceUrl: m[1]!, sourceName: m[2]! });
    }
    return results;
  } catch (e) {
    dbgErr("allanime-api", "tobeparsed decryption failed", e);
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

// ── Stream link resolution (ani-cli get_links) ────────────────────────────────

export type StreamLink = {
  url: string;
  quality: string;
  referer?: string;
  subtitle?: string;
};

function episodeOrderValue(episodeString: string): number | null {
  const parsed = Number.parseFloat(episodeString);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareEpisodeStrings(a: string, b: string): number {
  const aValue = episodeOrderValue(a);
  const bValue = episodeOrderValue(b);

  if (aValue !== null && bValue !== null && aValue !== bValue) {
    return aValue - bValue;
  }

  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
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

const KNOWN_SOURCES = new Set(["Default", "Yt-mp4", "S-mp4", "Luf-Mp4"]);

function isDirectStream(url: string): boolean {
  const l = url.toLowerCase();
  return (
    l.includes(".m3u8") ||
    l.includes(".mp4") ||
    l.includes(".mkv") ||
    l.includes("repackager.wixmp.com") ||
    l.includes("tools.fast4speed.rsvp")
  );
}

async function fetchStreamLinks(
  apiPath: string,
  referer: string,
  ua: string,
): Promise<StreamLink[]> {
  const res = await fetch(`https://allanime.day${apiPath}`, {
    headers: { Referer: referer, "User-Agent": ua },
  });
  if (!res.ok) return [];

  let body = await res.text();
  body = body.replace(/\\u002F/g, "/").replace(/\\\//g, "/");

  const links: StreamLink[] = [];

  // ── JSON structured response ──────────────────────────────────────────────
  try {
    const j = JSON.parse(body) as {
      links?: Array<{ link: string; resolutionStr?: string; hls?: boolean }>;
      subtitles?: Array<{ lang: string; src: string }>;
      // ani-cli: m3u8_refr extracted from top-level Referer field
      Referer?: string;
    };

    // ani-cli: m3u8_refr — the actual CDN referer needed to fetch variant streams.
    // Falls back to the configured allanime referer if not present in the response.
    const m3u8Referer = j.Referer ?? referer;

    const sub = j.subtitles?.find((s) => s.lang?.toLowerCase().startsWith("en"))?.src;

    if (j.links?.length) {
      for (const l of j.links) {
        if (!l.link) continue;

        // wixmp repackager — extract quality variants (ani-cli get_links wixmp branch)
        if (l.link.includes("repackager.wixmp.com")) {
          const base = l.link.replace(/repackager\.wixmp\.com\//g, "").replace(/\.urlset.*/, "");
          const qMatch = /\/,([^/]*),\/mp4/.exec(l.link);
          const variants = qMatch?.[1]?.split(",").filter(Boolean) ?? [];
          for (const q of variants) {
            links.push({ url: base.replace(/,[^/]*/, q), quality: q, subtitle: sub });
          }
          if (variants.length === 0)
            links.push({ url: l.link, quality: l.resolutionStr ?? "", subtitle: sub });
          continue;
        }

        // master.m3u8 — resolve quality variants (ani-cli get_links m3u8 branch)
        // Uses the Referer extracted from the JSON body, not cfg.referer (ani-cli: m3u8_refr).
        if (l.link.includes("master.m3u8")) {
          const m3uRes = await fetch(l.link, {
            headers: { Referer: m3u8Referer, "User-Agent": ua },
          });
          if (m3uRes.ok) {
            const m3u = await m3uRes.text();
            const urlOf = new URL(l.link);
            const base2 = `${urlOf.protocol}//${urlOf.host}${urlOf.pathname.replace(/[^/]*$/, "")}`;

            // Extract quality + URL pairs from #EXT-X-STREAM-INF lines, skip I-FRAME tracks
            const streamRe = /RESOLUTION=\d+x(\d+)[^\n]*\n([^\n]+)/g;
            let sm: RegExpExecArray | null;
            while ((sm = streamRe.exec(m3u)) !== null) {
              const quality = sm[1] ?? "unknown";
              const href = sm[2]?.trim() ?? "";
              if (!href || href.startsWith("#")) continue;
              const url2 = href.startsWith("http") ? href : base2 + href;
              links.push({ url: url2, quality, referer: m3u8Referer, subtitle: sub });
            }
          }
          continue;
        }

        links.push({ url: l.link, quality: l.resolutionStr ?? "", subtitle: sub });
      }
      return links;
    }
  } catch {
    /* fall through to regex */
  }

  // ── Regex fallback (matches ani-cli sed patterns) ─────────────────────────
  const linkRe = /"link"\s*:\s*"([^"]+)"/;
  const resRe = /"resolutionStr"\s*:\s*"([^"]*)"/;
  for (const chunk of body.split("},{")) {
    const lm = linkRe.exec(chunk);
    if (!lm?.[1]) continue;
    links.push({ url: lm[1], quality: resRe.exec(chunk)?.[1] ?? "" });
  }
  return links;
}

// ── GraphQL helpers ───────────────────────────────────────────────────────────

export async function gqlPost(
  apiUrl: string,
  referer: string,
  ua: string,
  query: string,
  vars: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Referer: referer, "User-Agent": ua },
    body: JSON.stringify({ query, variables: vars }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${apiUrl}`);
  return res.json();
}

// Raw-text variant — used where we need to string-match the response before
// parsing (e.g. detecting "tobeparsed" before trying to JSON.parse it).
export async function gqlRaw(
  apiUrl: string,
  referer: string,
  ua: string,
  query: string,
  vars: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Referer: referer, "User-Agent": ua },
    body: JSON.stringify({ query, variables: vars }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${apiUrl}`);
  return res.text();
}

// ── Full episode source resolution ────────────────────────────────────────────

export async function resolveEpisodeSources(opts: {
  apiUrl: string;
  referer: string;
  ua: string;
  showId: string;
  epStr: string;
  mode: "sub" | "dub";
}): Promise<StreamLink[]> {
  const { apiUrl, referer, ua, showId, epStr, mode } = opts;

  // ── ani-cli exact: select only episodeString + sourceUrls, NOT tobeparsed ──
  // Detect tobeparsed by string-matching the raw response, then extract with
  // regex — same approach as ani-cli's grep + sed.  Including tobeparsed in
  // the GQL selection risks a schema error if the field is renamed/removed.
  const Q = `query($showId:String! $translationType:VaildTranslationTypeEnumType! $episodeString:String!){
    episode(showId:$showId translationType:$translationType episodeString:$episodeString){
      episodeString sourceUrls
    }
  }`;

  const rawText = await gqlRaw(apiUrl, referer, ua, Q, {
    showId,
    translationType: mode,
    episodeString: epStr,
  });

  let rawSources: Array<{ sourceUrl: string; sourceName: string }> = [];

  if (rawText.includes('"tobeparsed"')) {
    // ani-cli: blob="$(... sed -nE 's|.*"tobeparsed":"([^"]*)".*|\1|p')"
    const blobMatch = /"tobeparsed"\s*:\s*"([^"]+)"/.exec(rawText);
    if (blobMatch?.[1]) {
      rawSources = await decodeTobeparsed(blobMatch[1]);
    }
  } else {
    // ani-cli: sed 's|\\u002F|\/|g;s|\\||g' | sed -nE 's|.*sourceUrl":"--([^"]*)".*sourceName":"([^"]*)".*|\2 :\1|p'
    // Only process --prefixed sourceUrls (ani-cli ignores any without --)
    const data = JSON.parse(rawText) as {
      data: { episode: { sourceUrls?: Array<{ sourceUrl: string; sourceName: string }> } };
    };
    rawSources = (data.data.episode?.sourceUrls ?? []).filter((s) => s.sourceUrl.startsWith("--"));
  }

  // ── Decode all sources first ──────────────────────────────────────────────
  const direct: StreamLink[] = [];
  const apiJobs: Promise<StreamLink[]>[] = [];

  for (const src of rawSources) {
    const raw = src.sourceUrl.startsWith("--") ? src.sourceUrl.slice(2) : src.sourceUrl;
    const decoded = hexDecode(raw);
    if (!decoded) continue;

    if (isDirectStream(decoded)) {
      direct.push({
        url: decoded,
        quality: src.sourceName,
        referer: decoded.includes("tools.fast4speed.rsvp") ? referer : undefined,
      });
      continue;
    }

    if (!decoded.startsWith("/") || !KNOWN_SOURCES.has(src.sourceName)) continue;

    // Queue as a background job — mirrors ani-cli's:
    //   generate_link "$provider" >"$cache_dir/$provider" &
    // All API paths fire simultaneously; we collect results with Promise.allSettled.
    const sourceName = src.sourceName;
    apiJobs.push(
      fetchStreamLinks(decoded, referer, ua)
        .then((ls) => ls.map((l) => ({ ...l, quality: l.quality || sourceName })))
        .catch(() => [] as StreamLink[]),
    );
  }

  // Wait for all parallel jobs (mirrors ani-cli's `wait` after the background loop)
  const settled = await Promise.allSettled(apiJobs);
  const apiLinks = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  // Sort by quality descending (numeric, like ani-cli's `sort -g -r -s`)
  const all = [...direct, ...apiLinks].sort(
    (a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0),
  );
  return all;
}

export async function fetchAllAnimeEpisodeCatalog(opts: {
  apiUrl: string;
  referer: string;
  ua: string;
  showId: string;
  mode: "sub" | "dub";
}): Promise<EpisodePickerOption[]> {
  const { apiUrl, referer, ua, showId, mode } = opts;
  const listQ = `query($id:String!){show(_id:$id){availableEpisodesDetail}}`;
  const listData = (await gqlPost(apiUrl, referer, ua, listQ, { id: showId })) as {
    data: { show: { availableEpisodesDetail: Record<string, unknown[]> } };
  };
  const episodeStrings = (listData.data.show.availableEpisodesDetail[mode] ?? []) as string[];

  return [...episodeStrings].sort(compareEpisodeStrings).map((episodeString, index) => ({
    index: index + 1,
    label: `Episode ${episodeString}`,
    detail: `Source episode ${episodeString}`,
  }));
}

// ── Factory: createAllAnimeApiProvider ────────────────────────────────────────
//
// Builds an ApiProvider from a minimal config object.
// Adding a new allanime-compatible provider = call this function with
// a different endpoint/domain, no changes to anything else.

export type AnimeProviderConfig = {
  id: string;
  name: string;
  description: string;
  domain: string;
  apiUrl: string; // GraphQL endpoint
  referer: string; // Referer header (e.g. "https://allmanga.to")
  ua?: string; // User-Agent (optional, defaults to Firefox)
  recommended?: boolean;
  isAnimeProvider?: boolean;
};

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";

export function createAllAnimeApiProvider(cfg: AnimeProviderConfig): ApiProvider {
  const ua = cfg.ua ?? DEFAULT_UA;

  return {
    kind: "api",
    searchBackend: "allanime",
    id: cfg.id,
    name: cfg.name,
    description: cfg.description,
    domain: cfg.domain,
    recommended: cfg.recommended,
    isAnimeProvider: cfg.isAnimeProvider,

    async search(query, opts) {
      dbg(cfg.id, "search", { query, mode: opts.animeLang });
      // ani-cli search_gql — countryOrigin:"ALL" is required to get full results
      const Q = `query($search:SearchInput $limit:Int $page:Int $translationType:VaildTranslationTypeEnumType $countryOrigin:VaildCountryOriginEnumType){
        shows(search:$search limit:$limit page:$page translationType:$translationType countryOrigin:$countryOrigin){
          edges{_id name availableEpisodes __typename}
        }
      }`;
      const data = (await gqlPost(cfg.apiUrl, cfg.referer, ua, Q, {
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

      return data.data.shows.edges.map((e): ApiSearchResult => {
        const epRaw = (e.availableEpisodes as Record<string, unknown>)[opts.animeLang];
        const epCount = typeof epRaw === "number" ? epRaw : undefined;
        return { id: e._id, title: e.name, type: "series", epCount };
      });
    },

    async resolveStream(id, _type, _season, episode, opts) {
      const mode = opts.animeLang;
      dbg(cfg.id, "resolveStream", { id, episode, mode });

      try {
        // Fetch episode list to map index → episode string
        const listQ = `query($id:String!){show(_id:$id){availableEpisodesDetail}}`;
        const listData = (await gqlPost(cfg.apiUrl, cfg.referer, ua, listQ, { id })) as {
          data: { show: { availableEpisodesDetail: Record<string, unknown[]> } };
        };
        const eps = (listData.data.show.availableEpisodesDetail[mode] ?? []) as string[];
        const epStr = resolveAnimeEpisodeString(eps, episode);
        dbg(cfg.id, "episode string", { epStr, total: eps.length });

        const links = await resolveEpisodeSources({
          apiUrl: cfg.apiUrl,
          referer: cfg.referer,
          ua,
          showId: id,
          epStr,
          mode,
        });
        dbg(cfg.id, "stream links", { count: links.length });

        // Quality preference: highest-numbered quality, or first m3u8
        const best =
          links.find((l) => l.url.includes("master.m3u8")) ??
          links.sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0))[0];

        if (!best) return null;

        const streamData: StreamData = {
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
        return streamData;
      } catch (e) {
        dbgErr(cfg.id, "resolveStream failed", e);
        return null;
      }
    },
  };
}
