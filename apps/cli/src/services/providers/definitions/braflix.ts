// =============================================================================
// Braflix Provider Adapter
// =============================================================================

import type { ProviderCapabilities, ProviderMetadata, StreamInfo, TitleInfo } from "@/domain/types";
import { braflixManifest } from "@kunai/core";
import type { Provider, ProviderDeps, StreamRequest } from "../Provider";
import {
  attachProviderResolveResult,
  manifestToProviderCapabilities,
  manifestToProviderMetadata,
} from "../core-manifest-adapter";

const DEFAULT_BASE = "https://braflix.mov";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
};

async function fetchHtml(url: string, extraHeaders?: Record<string, string>): Promise<string> {
  const res = await fetch(url, {
    headers: { ...HEADERS, ...extraHeaders },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Braflix ${res.status} ${url}`);
  return res.text();
}

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

function extractMediaId(href: string): string {
  const m = /[-/](\d+)\/?$/.exec(href);
  return m?.[1] ?? "";
}

async function getSeasonId(mediaId: string, seasonNumber: number): Promise<string> {
  const html = await fetchHtml(`${DEFAULT_BASE}/ajax/season/list/${mediaId}`);
  const ids = all(html, /class="ss-item[^"]*"[^>]*data-id="(\d+)"/);
  return ids[seasonNumber - 1] ?? ids[0] ?? "";
}

async function getEpisodeId(seasonId: string, episodeNumber: number): Promise<string> {
  const html = await fetchHtml(`${DEFAULT_BASE}/ajax/season/episodes/${seasonId}`);
  const ids = all(html, /class="eps-item[^"]*"[^>]*data-id="(\d+)"/);
  return ids[episodeNumber - 1] ?? ids[0] ?? "";
}

async function getMovieServerId(mediaId: string): Promise<string> {
  const html = await fetchHtml(`${DEFAULT_BASE}/ajax/episode/list/${mediaId}`);
  return (
    first(html, /class="link-item[^"]*"[^>]*data-id="(\d+)"/) || first(html, /data-linkid="(\d+)"/)
  );
}

async function getFirstServerId(episodeId: string): Promise<string> {
  const html = await fetchHtml(`${DEFAULT_BASE}/ajax/episode/servers/${episodeId}`);
  return first(html, /class="link-item[^"]*"[^>]*data-id="(\d+)"/);
}

async function resolveSourceLink(serverId: string): Promise<string> {
  const res = await fetch(`${DEFAULT_BASE}/ajax/episode/sources/${serverId}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Braflix sources ${res.status}`);
  const j = (await res.json()) as { link?: string };
  return j.link ?? "";
}

export class BraflixProvider implements Provider {
  readonly metadata: ProviderMetadata = manifestToProviderMetadata(braflixManifest);

  readonly capabilities: ProviderCapabilities = manifestToProviderCapabilities(braflixManifest);

  constructor(private deps: ProviderDeps) {}

  canHandle(title: TitleInfo): boolean {
    return title.type === "movie" || title.type === "series";
  }

  async resolveStream(request: StreamRequest, signal?: AbortSignal): Promise<StreamInfo | null> {
    try {
      const mediaId = extractMediaId(request.title.id);
      if (!mediaId) return null;

      let serverId: string;
      if (request.title.type === "movie") {
        serverId = await getMovieServerId(mediaId);
      } else {
        const seasonId = await getSeasonId(mediaId, request.episode?.season ?? 1);
        if (!seasonId) return null;
        const episodeId = await getEpisodeId(seasonId, request.episode?.episode ?? 1);
        if (!episodeId) return null;
        serverId = await getFirstServerId(episodeId);
      }

      if (!serverId) return null;

      const embedUrl = await resolveSourceLink(serverId);
      if (!embedUrl) return null;

      if (embedUrl.includes(".m3u8") || embedUrl.includes(".mp4")) {
        return attachProviderResolveResult({
          manifest: braflixManifest,
          request,
          mode: "series",
          runtime: "node-fetch",
          stream: {
            url: embedUrl,
            headers: {},
            subtitle: undefined,
            subtitleList: [],
            subtitleSource: "none",
            subtitleEvidence: {
              directSubtitleObserved: false,
              wyzieSearchObserved: false,
              reason: "not-observed",
            },
            timestamp: Date.now(),
          },
        });
      }

      const stream = await this.deps.browser.scrape({
        url: embedUrl,
        subLang: request.subLang,
        signal,
        tmdbId: request.title.id,
        titleType: request.title.type,
        season: request.episode?.season,
        episode: request.episode?.episode,
        playerDomains: this.deps.playerDomains,
      });

      return stream
        ? attachProviderResolveResult({
            manifest: braflixManifest,
            request,
            stream,
            mode: "series",
            runtime: "playwright-lease",
          })
        : null;
    } catch {
      this.deps.logger.error("braflix: resolveStream failed");
      return null;
    }
  }
}

export function createBraflixProvider(deps: ProviderDeps): Provider {
  return new BraflixProvider(deps);
}
