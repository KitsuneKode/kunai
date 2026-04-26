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
import { scrapeStream } from "@/scraper";
import type { PlaywrightProvider } from "@/providers/types";

export class BrowserServiceImpl implements BrowserService {
  constructor(
    private deps: {
      logger: Logger;
      tracer: Tracer;
      config: ConfigService;
      cacheStore: CacheStore;
      diagnosticsStore: DiagnosticsStore;
    },
  ) {}

  async scrape(options: ScrapeOptions): Promise<StreamInfo | null> {
    const requestedSubLang = options.subLang ?? this.deps.config.subLang;
    const cached = await this.deps.cacheStore.get(options.url);
    if (cached) {
      const needsSubtitleRefresh = requestedSubLang !== "none" && !cached.subtitle;
      this.deps.logger.info("Browser scrape cache hit", {
        url: options.url,
        needsSubtitleRefresh,
      });
      this.deps.diagnosticsStore.record({
        category: "cache",
        message: needsSubtitleRefresh
          ? "Browser scrape cache hit without subtitles; refreshing"
          : "Browser scrape cache hit",
        context: {
          url: options.url,
          requestedSubLang,
          subtitle: cached.subtitle ?? null,
          subtitleTrackCount: cached.subtitleList?.length ?? 0,
        },
      });
      if (!needsSubtitleRefresh) {
        return cached;
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

    // Create a synthetic PlaywrightProvider for the legacy scraper
    const syntheticProvider: PlaywrightProvider = {
      kind: "playwright",
      id: "embed",
      name: "Embed",
      description: "",
      domain: new URL(options.url).hostname,
      recommended: false,
      movieUrl: () => options.url,
      seriesUrl: () => options.url,
      needsClick: options.needsClick ?? false,
      titleSource: "page-title",
    };

    const result = await scrapeStream(
      syntheticProvider,
      options.url,
      options.subLang ?? this.deps.config.subLang,
      this.deps.config.headless,
    );

    if (!result) return null;

    const stream = {
      url: result.url,
      headers: result.headers,
      subtitle: result.subtitle ?? undefined,
      subtitleList: result.subtitleList as SubtitleTrack[] | undefined,
      subtitleSource: result.subtitleSource,
      subtitleEvidence: result.subtitleEvidence,
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
