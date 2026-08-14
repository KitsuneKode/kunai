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
  subLang?: string;
  signal?: AbortSignal;
  // Metadata for late subtitle lookup. Browser scraping must not block stream
  // launch on active subtitle resolution.
  tmdbId?: string;
  titleType?: "movie" | "series";
  season?: number;
  episode?: number;
  playerDomains?: string[];
}

export interface BrowserService {
  scrape(options: ScrapeOptions): Promise<StreamInfo | null>;
  isAvailable(): Promise<boolean>;
}
