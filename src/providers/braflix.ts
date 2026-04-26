import type { ApiProvider, ApiSearchResult, ResolveOpts } from "./types";
import { dbg, dbgErr } from "@/logger";

// =============================================================================
// Braflix  (braflix.mov — HTTP AJAX, no browser for metadata)
//
// Flow:
//   1. Search: GET /search/{query}        → parse HTML results
//   2. Media ID: extract from result URL  → numeric ID
//   3. Seasons:  GET /ajax/season/list/{id}          → HTML season list
//   4. Episodes: GET /ajax/season/episodes/{seasonId} → HTML episode list
//   5. Servers:  GET /ajax/episode/servers/{episodeId} → HTML server list
//   6. Source:   GET /ajax/episode/sources/{serverId}  → JSON { link }
//   7. The `link` is a video embed URL — caller passes it to embedScraper
//      (Playwright) to extract the actual .m3u8.
//
// Domain can be overridden via ~/.config/kitsunesnipe/providers.json
// =============================================================================

const DEFAULT_BASE = "https://braflix.mov";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
};

function base(): string {
  // Domain override hook — set by loadDomainOverrides() before first use.
  return ((globalThis as Record<string, unknown>).__braflixBase as string) ?? DEFAULT_BASE;
}

async function fetchHtml(url: string, extraHeaders?: Record<string, string>): Promise<string> {
  const res = await fetch(url, {
    headers: { ...HEADERS, ...extraHeaders },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Braflix ${res.status} ${url}`);
  return res.text();
}

// ── HTML parsing (regex — avoids a parser dep) ────────────────────────────────

// Extract all occurrences of a regex group from an HTML string.
function all(html: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : "g" + re.flags);
  while ((m = r.exec(html)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function first(html: string, re: RegExp): string {
  return all(html, re)[0] ?? "";
}

// ── Search ────────────────────────────────────────────────────────────────────

export async function braflixSearch(query: string): Promise<ApiSearchResult[]> {
  const slug = encodeURIComponent(query.toLowerCase().replace(/\s+/g, "-"));
  const html = await fetchHtml(`${base()}/search/${slug}`, { "X-Requested-With": "" });

  // Each result card: <div class="flw-item">
  const cards = html.split('<div class="flw-item"').slice(1);

  return cards.flatMap((card): ApiSearchResult[] => {
    const href = first(card, /class="film-name[^"]*"[^>]*>.*?href="([^"]+)"/s);
    const title = first(card, /title="([^"]+)"/);
    if (!href || !title) return [];

    const type: "movie" | "series" = href.includes("/tv/") ? "series" : "movie";

    // Year: first 4-digit sequence in the info block
    const infoBlock = first(card, /class="film-infor"[^>]*>([\s\S]*?)<\/div>/);
    const year = first(infoBlock, /\b(\d{4})\b/);

    const poster = first(card, /data-src="([^"]+film-poster[^"]+)"/);

    return [{ id: href, title, type, year: year || undefined, posterUrl: poster || undefined }];
  });
}

// ── ID extraction ─────────────────────────────────────────────────────────────

function extractMediaId(href: string): string {
  // URLs end with -<numeric-id>  e.g. /movie/watch-...-19722
  const m = /[-/](\d+)\/?$/.exec(href);
  return m?.[1] ?? "";
}

// ── Season / episode / server / source ───────────────────────────────────────

async function getSeasonId(mediaId: string, seasonNumber: number): Promise<string> {
  const html = await fetchHtml(`${base()}/ajax/season/list/${mediaId}`);
  const ids = all(html, /class="ss-item[^"]*"[^>]*data-id="(\d+)"/);
  // seasons are ordered 1..N; pick by index
  return ids[seasonNumber - 1] ?? ids[0] ?? "";
}

async function getEpisodeId(seasonId: string, episodeNumber: number): Promise<string> {
  const html = await fetchHtml(`${base()}/ajax/season/episodes/${seasonId}`);
  const ids = all(html, /class="eps-item[^"]*"[^>]*data-id="(\d+)"/);
  return ids[episodeNumber - 1] ?? ids[0] ?? "";
}

async function getMovieServerId(mediaId: string): Promise<string> {
  // For movies, episode/list returns server link-items directly
  const html = await fetchHtml(`${base()}/ajax/episode/list/${mediaId}`);
  return (
    first(html, /class="link-item[^"]*"[^>]*data-id="(\d+)"/) || first(html, /data-linkid="(\d+)"/)
  );
}

async function getFirstServerId(episodeId: string): Promise<string> {
  const html = await fetchHtml(`${base()}/ajax/episode/servers/${episodeId}`);
  return first(html, /class="link-item[^"]*"[^>]*data-id="(\d+)"/);
}

async function resolveSourceLink(serverId: string): Promise<string> {
  const res = await fetch(`${base()}/ajax/episode/sources/${serverId}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Braflix sources ${res.status}`);
  const j = (await res.json()) as { link?: string };
  return j.link ?? "";
}

// ── Provider object ───────────────────────────────────────────────────────────

export const Braflix: ApiProvider = {
  kind: "api",
  searchBackend: "self",
  id: "braflix",
  name: "Braflix",
  description: "Braflix  (braflix.mov, no browser for metadata)",
  domain: "braflix.mov",
  recommended: false,

  async search(query) {
    dbg("braflix", "search", { query });
    return braflixSearch(query);
  },

  async resolveStream(id, type, season, episode, opts: ResolveOpts) {
    dbg("braflix", "resolveStream", { id, type, season, episode });

    try {
      const mediaId = extractMediaId(id);
      if (!mediaId) {
        dbg("braflix", "could not extract media ID", { id });
        return null;
      }

      let serverId: string;
      if (type === "movie") {
        serverId = await getMovieServerId(mediaId);
      } else {
        const seasonId = await getSeasonId(mediaId, season);
        if (!seasonId) {
          dbg("braflix", "no season found", { season });
          return null;
        }
        const episodeId = await getEpisodeId(seasonId, episode);
        if (!episodeId) {
          dbg("braflix", "no episode found", { episode });
          return null;
        }
        serverId = await getFirstServerId(episodeId);
      }

      if (!serverId) {
        dbg("braflix", "no server found");
        return null;
      }

      const embedUrl = await resolveSourceLink(serverId);
      if (!embedUrl) {
        dbg("braflix", "no embed URL");
        return null;
      }

      dbg("braflix", "embed URL resolved", { embedUrl });

      // If it's already a direct stream, return as-is.
      if (embedUrl.includes(".m3u8") || embedUrl.includes(".mp4")) {
        return {
          url: embedUrl,
          headers: {},
          subtitle: null,
          subtitleList: [],
          subtitleSource: "none",
          subtitleEvidence: {
            directSubtitleObserved: false,
            wyzieSearchObserved: false,
            reason: "not-observed",
          },
          title: "",
          timestamp: Date.now(),
        };
      }

      // Otherwise hand the embed URL to the Playwright scraper.
      return opts.embedScraper(embedUrl);
    } catch (e) {
      dbgErr("braflix", "resolveStream failed", e);
      return null;
    }
  },
};
