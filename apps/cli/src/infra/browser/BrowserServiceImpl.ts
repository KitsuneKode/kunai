// =============================================================================
// Browser Service Implementation
//
// Delegates to the existing scraper.ts for Playwright-based stream extraction.
// =============================================================================

import type { BrowserService, ScrapeOptions } from "./BrowserService";
import type { StreamInfo, SubtitleTrack } from "@/domain/types";
import type { Logger } from "@/infra/logger/Logger";
import type { Tracer } from "@/infra/tracer/Tracer";
import type { ConfigService } from "@/services/persistence/ConfigService";
import type { CacheStore } from "@/services/persistence/CacheStore";
import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";
import { scrapeStream, type ScrapeConfig } from "@/scraper";
import { resolveSubtitlesByTmdbId, selectSubtitle } from "@/subtitle";

type ScrapeStreamFn = typeof scrapeStream;
type ResolveSubtitlesByTmdbIdFn = typeof resolveSubtitlesByTmdbId;

export class BrowserServiceImpl implements BrowserService {
  constructor(
    private deps: {
      logger: Logger;
      tracer: Tracer;
      config: ConfigService;
      cacheStore: CacheStore;
      diagnosticsStore: DiagnosticsStore;
      scrapeStreamImpl?: ScrapeStreamFn;
      resolveSubtitlesByTmdbIdImpl?: ResolveSubtitlesByTmdbIdFn;
    },
  ) {}

  async scrape(options: ScrapeOptions): Promise<StreamInfo | null> {
    const requestedSubLang = options.subLang ?? this.deps.config.subLang;
    const scrapeStreamImpl = this.deps.scrapeStreamImpl ?? scrapeStream;
    const resolveSubtitlesByTmdbIdImpl =
      this.deps.resolveSubtitlesByTmdbIdImpl ?? resolveSubtitlesByTmdbId;
    const cached = await this.deps.cacheStore.get(options.url);
    if (cached) {
      let activeSubtitle = cached.subtitle;
      let needsSubtitleRefresh = false;

      if (requestedSubLang !== "none") {
        if (cached.subtitleList && cached.subtitleList.length > 0) {
          const pick = selectSubtitle(cached.subtitleList as any, requestedSubLang);
          activeSubtitle = pick?.url ?? undefined;
          if (!activeSubtitle && cached.subtitleSource !== "wyzie") {
            needsSubtitleRefresh = true;
          }
        } else if (!cached.subtitle) {
          needsSubtitleRefresh = true;
        }
      }

      this.deps.logger.info("Browser scrape cache hit", {
        url: options.url,
        needsSubtitleRefresh,
      });
      this.deps.diagnosticsStore.record({
        category: "cache",
        message: needsSubtitleRefresh
          ? "Browser scrape cache hit missing requested language; refreshing"
          : "Browser scrape cache hit",
        context: {
          url: options.url,
          requestedSubLang,
          subtitle: activeSubtitle ?? null,
          subtitleTrackCount: cached.subtitleList?.length ?? 0,
        },
      });
      if (!needsSubtitleRefresh) {
        return { ...cached, subtitle: activeSubtitle };
      }

      if (options.tmdbId && options.titleType) {
        this.deps.diagnosticsStore.record({
          category: "subtitle",
          message: "Refreshing cached subtitle metadata from active Wyzie without browser relaunch",
          context: {
            url: options.url,
            tmdbId: options.tmdbId,
            titleType: options.titleType,
            season: options.season,
            episode: options.episode,
            requestedSubLang,
          },
        });

        const wyzieResult = await resolveSubtitlesByTmdbIdImpl({
          tmdbId: options.tmdbId,
          type: options.titleType,
          season: options.season,
          episode: options.episode,
          preferredLang: requestedSubLang,
        });

        if (wyzieResult.list.length > 0) {
          const refreshedStream: StreamInfo = {
            ...cached,
            subtitle: wyzieResult.selected ?? undefined,
            subtitleList: wyzieResult.list as unknown as SubtitleTrack[],
            subtitleSource: wyzieResult.selected ? "wyzie" : "none",
            subtitleEvidence: {
              directSubtitleObserved: false,
              wyzieSearchObserved: true,
              reason: wyzieResult.selected ? "wyzie-selected" : "wyzie-empty",
            },
          };
          await this.deps.cacheStore.set(options.url, refreshedStream);
          return refreshedStream;
        }

        this.deps.diagnosticsStore.record({
          category: "subtitle",
          message: wyzieResult.failed
            ? "Cached stream kept after active Wyzie refresh failed"
            : "Cached stream kept after active Wyzie found no tracks",
          context: {
            url: options.url,
            tmdbId: options.tmdbId,
            requestedSubLang,
          },
        });
        return { ...cached, subtitle: activeSubtitle };
      }
    } else {
      this.deps.diagnosticsStore.record({
        category: "cache",
        message: "Browser scrape cache miss",
        context: { url: options.url, requestedSubLang },
      });
    }
    this.deps.diagnosticsStore.record({
      category: "provider",
      message: "Browser scrape started",
      context: { url: options.url, subLang: requestedSubLang },
    });

    // Create a synthetic config for the scraper
    const syntheticConfig: ScrapeConfig = {
      id: "embed",
      needsClick: options.needsClick ?? false,
      titleSource: "page-title",
      playerDomains: options.playerDomains,
    };

    const result = await scrapeStreamImpl(
      syntheticConfig,
      options.url,
      options.subLang ?? this.deps.config.subLang,
      this.deps.config.headless,
    );

    if (!result) return null;

    let scrapeSubtitle = result.subtitle ?? undefined;
    let scrapeSubtitleList = result.subtitleList as SubtitleTrack[] | undefined;
    let scrapeSubtitleSource = result.subtitleSource;
    let scrapeSubtitleEvidence = result.subtitleEvidence;

    // Active Wyzie resolution: if the passive sniff found no subtitle and we
    // have a TMDB ID, query Wyzie directly. This covers the Vidking/lazy-load
    // case documented in .docs/subtitle-resolver-analysis.md.
    if (!scrapeSubtitle && requestedSubLang !== "none" && options.tmdbId && options.titleType) {
      this.deps.logger.info("No subtitle from passive sniff — trying active Wyzie", {
        tmdbId: options.tmdbId,
        titleType: options.titleType,
        season: options.season,
        episode: options.episode,
        requestedSubLang,
      });
      this.deps.diagnosticsStore.record({
        category: "subtitle",
        message: "Passive sniff found no subtitle — falling back to active Wyzie fetch",
        context: {
          tmdbId: options.tmdbId,
          titleType: options.titleType,
          season: options.season,
          episode: options.episode,
          requestedSubLang,
        },
      });

      const wyzieResult = await resolveSubtitlesByTmdbIdImpl({
        tmdbId: options.tmdbId,
        type: options.titleType,
        season: options.season,
        episode: options.episode,
        preferredLang: requestedSubLang,
      });

      if (wyzieResult.list.length > 0) {
        scrapeSubtitle = wyzieResult.selected ?? undefined;
        scrapeSubtitleList = wyzieResult.list as unknown as SubtitleTrack[];
        scrapeSubtitleSource = scrapeSubtitle ? "wyzie" : "none";
        scrapeSubtitleEvidence = {
          directSubtitleObserved: false,
          wyzieSearchObserved: true,
          reason: scrapeSubtitle ? "wyzie-selected" : "wyzie-empty",
        };
        this.deps.logger.info("Active Wyzie resolved subtitles", {
          selected: scrapeSubtitle ?? null,
          total: wyzieResult.list.length,
        });
      } else {
        this.deps.diagnosticsStore.record({
          category: "subtitle",
          message: wyzieResult.failed
            ? "Active Wyzie fetch failed"
            : "Active Wyzie found no tracks",
          context: { tmdbId: options.tmdbId, requestedSubLang },
        });
      }
    }

    const stream = {
      url: result.url,
      headers: result.headers,
      subtitle: scrapeSubtitle,
      subtitleList: scrapeSubtitleList,
      subtitleSource: scrapeSubtitleSource,
      subtitleEvidence: scrapeSubtitleEvidence,
      title: result.title,
      timestamp: result.timestamp,
    };
    await this.deps.cacheStore.set(options.url, stream);
    this.deps.diagnosticsStore.record({
      category: stream.subtitle ? "subtitle" : "provider",
      message: "Browser scrape resolved stream",
      context: {
        url: options.url,
        streamUrl: stream.url,
        subtitle: stream.subtitle ?? null,
        subtitleTrackCount: stream.subtitleList?.length ?? 0,
        subtitleSource: stream.subtitleSource ?? "none",
        subtitleEvidence: stream.subtitleEvidence ?? null,
      },
    });
    return stream;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { chromium } = await import("playwright");
      // Try to launch a headless browser to check availability
      const browser = await chromium.launch({ headless: true });
      await browser.close();
      return true;
    } catch {
      return false;
    }
  }
}
