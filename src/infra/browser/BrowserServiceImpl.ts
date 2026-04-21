// =============================================================================
// Browser Service Implementation
//
// Delegates to the existing scraper.ts for Playwright-based stream extraction.
// =============================================================================

import type { BrowserService, ScrapeOptions } from "./BrowserService";
import type { StreamInfo } from "../../domain/types";
import type { Logger } from "../logger/Logger";
import type { Tracer } from "../tracer/Tracer";
import type { ConfigService } from "../../services/persistence/ConfigService";
import { scrapeStream } from "../../scraper";
import type { PlaywrightProvider } from "../../providers/types";

export class BrowserServiceImpl implements BrowserService {
  constructor(
    private deps: {
      logger: Logger;
      tracer: Tracer;
      config: ConfigService;
    },
  ) {}

  async scrape(options: ScrapeOptions): Promise<StreamInfo | null> {
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
      "en", // TODO: Get from config
      this.deps.config.headless,
    );

    if (!result) return null;

    return {
      url: result.url,
      headers: result.headers,
      subtitle: result.subtitle ?? undefined,
      subtitleList: result.subtitleList as
        | import("../../domain/types").SubtitleTrack[]
        | undefined,
      title: result.title,
      timestamp: result.timestamp,
    };
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
