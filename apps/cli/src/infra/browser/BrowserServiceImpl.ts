// =============================================================================
// Browser Service Implementation
//
// Delegates to the existing scraper.ts for Playwright-based stream extraction.
// =============================================================================

import type { StreamInfo, SubtitleTrack } from "@/domain/types";
import type { Logger } from "@/infra/logger/Logger";
import type { Tracer } from "@/infra/tracer/Tracer";
import { scrapeStream, type ScrapeConfig } from "@/scraper";
import { buildEmbedStreamCacheKey } from "@/services/cache/stream-resolve-cache";
import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";
import type { CacheStore } from "@/services/persistence/CacheStore";
import type { ConfigService } from "@/services/persistence/ConfigService";
import { selectSubtitle } from "@/subtitle";

import type { BrowserService, ScrapeOptions } from "./BrowserService";

type ScrapeStreamFn = typeof scrapeStream;

export class BrowserServiceImpl implements BrowserService {
  constructor(
    private deps: {
      logger: Logger;
      tracer: Tracer;
      config: ConfigService;
      cacheStore: CacheStore;
      diagnosticsStore: DiagnosticsStore;
      scrapeStreamImpl?: ScrapeStreamFn;
    },
  ) {}

  async scrape(options: ScrapeOptions): Promise<StreamInfo | null> {
    const requestedSubLang = options.subLang ?? this.deps.config.subLang;
    const scrapeStreamImpl = this.deps.scrapeStreamImpl ?? scrapeStream;
    const cacheKey = buildEmbedStreamCacheKey(options.url);
    const cached = await this.deps.cacheStore.get(cacheKey);
    if (cached) {
      let activeSubtitle = cached.subtitle;

      if (requestedSubLang !== "none") {
        if (cached.subtitleList && cached.subtitleList.length > 0) {
          const pick = selectSubtitle(cached.subtitleList as any, requestedSubLang);
          activeSubtitle = pick?.url ?? undefined;
        }
      }

      this.deps.logger.info("Browser scrape cache hit", {
        url: options.url,
        needsSubtitleRefresh: false,
      });
      this.deps.diagnosticsStore.record({
        category: "cache",
        message: "Browser scrape cache hit",
        context: {
          url: options.url,
          requestedSubLang,
          subtitle: activeSubtitle ?? null,
          subtitleTrackCount: cached.subtitleList?.length ?? 0,
        },
      });
      return { ...cached, subtitle: activeSubtitle, cacheProvenance: "cached" };
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
      options.signal,
    );

    if (!result) return null;

    const scrapeSubtitle = result.subtitle ?? undefined;
    const scrapeSubtitleList = result.subtitleList as SubtitleTrack[] | undefined;
    const scrapeSubtitleSource = result.subtitleSource;
    const scrapeSubtitleEvidence = result.subtitleEvidence;

    if (
      requestedSubLang !== "none" &&
      options.tmdbId &&
      options.titleType &&
      (!scrapeSubtitle || !scrapeSubtitleList?.length)
    ) {
      this.deps.logger.info("No subtitle from passive sniff; deferring active subtitle lookup", {
        tmdbId: options.tmdbId,
        titleType: options.titleType,
        season: options.season,
        episode: options.episode,
        requestedSubLang,
      });
      this.deps.diagnosticsStore.record({
        category: "subtitle",
        message:
          "Passive sniff found no subtitle; playback will not wait for active subtitle lookup",
        context: {
          tmdbId: options.tmdbId,
          titleType: options.titleType,
          season: options.season,
          episode: options.episode,
          requestedSubLang,
          reason: "subtitle-resolution-deferred",
        },
      });
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
      cacheProvenance: "fresh" as const,
    };
    await this.deps.cacheStore.set(cacheKey, stream);
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
