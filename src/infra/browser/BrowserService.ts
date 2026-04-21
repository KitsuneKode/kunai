// =============================================================================
// Browser Service Interface
//
// Playwright abstraction for scraping.
// =============================================================================

import type { StreamInfo } from "../../domain/types";

export interface ScrapeOptions {
  url: string;
  needsClick?: boolean;
  intercept?: string[]; // URL patterns to intercept (e.g., "*.m3u8")
  signal?: AbortSignal;
}

export interface BrowserService {
  scrape(options: ScrapeOptions): Promise<StreamInfo | null>;
  isAvailable(): Promise<boolean>;
}
