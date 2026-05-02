import { describe, expect, mock, test } from "bun:test";

import { BrowserServiceImpl } from "@/infra/browser/BrowserServiceImpl";
import type { Logger } from "@/infra/logger/Logger";
import type { Tracer } from "@/infra/tracer/Tracer";
import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";
import type { CacheStore } from "@/services/persistence/CacheStore";
import type { ConfigService, KitsuneConfig } from "@/services/persistence/ConfigService";

function createLogger(): Logger {
  const noop = () => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => createLogger(),
  };
}

function createTracer(): Tracer {
  return {
    async span<T>(
      _name: string,
      fn: (span: Parameters<Parameters<Tracer["span"]>[1]>[0]) => Promise<T>,
    ): Promise<T> {
      return await fn({
        id: "span",
        name: "span",
        startTime: Date.now(),
        setAttribute() {},
        addEvent() {},
        end() {},
      });
    },
    getCurrentTrace: () => null,
    getCurrentSpan: () => null,
  };
}

function createConfig(overrides: Partial<KitsuneConfig> = {}): ConfigService {
  const config: KitsuneConfig = {
    defaultMode: "series",
    provider: "vidking",
    animeProvider: "allanime",
    subLang: "en",
    animeLang: "sub",
    headless: true,
    showMemory: false,
    autoNext: false,
    skipRecap: true,
    skipIntro: true,
    skipPreview: true,
    footerHints: "detailed",
    ...overrides,
  };

  return {
    ...config,
    getRaw: () => ({ ...config }),
    update: async () => {},
    save: async () => {},
    reset: async () => {},
  };
}

function createDiagnosticsStore(): DiagnosticsStore {
  const events: Array<{ message: string }> = [];
  return {
    record(event) {
      events.push({ message: event.message });
    },
    getRecent() {
      return events.map((event, index) => ({
        timestamp: index,
        category: "cache" as const,
        message: event.message,
      }));
    },
    clear() {
      events.length = 0;
    },
  };
}

describe("BrowserServiceImpl", () => {
  test("returns cached streams directly without automatic subtitle refresh", async () => {
    const cachedStream = {
      url: "https://cdn.example/master.m3u8",
      headers: { referer: "https://www.vidking.net/" },
      subtitleSource: "none" as const,
      subtitleList: [],
      timestamp: Date.now(),
    };

    const cacheSet = mock(async () => {});
    const cacheStore: CacheStore = {
      ttl: 1000,
      get: async () => cachedStream,
      set: cacheSet,
      delete: async () => {},
      clear: async () => {},
      prune: async () => {},
    };

    const scrapeStreamImpl = mock(async () => {
      throw new Error("browser scrape should not be called");
    });
    const service = new BrowserServiceImpl({
      logger: createLogger(),
      tracer: createTracer(),
      config: createConfig(),
      cacheStore,
      diagnosticsStore: createDiagnosticsStore(),
      scrapeStreamImpl,
    });

    const result = await service.scrape({
      url: "https://www.vidking.net/embed/tv/127529/1/2?autoPlay=true",
      subLang: "en",
      tmdbId: "127529",
      titleType: "series",
      season: 1,
      episode: 2,
    });

    expect(result?.subtitle).toBeUndefined();
    expect(result?.subtitleSource).toBe("none");
    expect(scrapeStreamImpl).toHaveBeenCalledTimes(0);
    expect(cacheSet).toHaveBeenCalledTimes(0);
  });

  test("returns scraped streams without blocking on active subtitle lookup", async () => {
    const cacheStore: CacheStore = {
      ttl: 1000,
      get: async () => null,
      set: async () => {},
      delete: async () => {},
      clear: async () => {},
      prune: async () => {},
    };

    const scrapeStreamImpl = mock(async () => ({
      url: "https://cdn.example/master.m3u8",
      headers: { referer: "https://www.vidking.net/" },
      subtitle: null,
      subtitleList: [],
      subtitleSource: "none" as const,
      subtitleEvidence: { reason: "not-observed" as const },
      title: "Bloodhounds",
      timestamp: Date.now(),
    }));
    const service = new BrowserServiceImpl({
      logger: createLogger(),
      tracer: createTracer(),
      config: createConfig(),
      cacheStore,
      diagnosticsStore: createDiagnosticsStore(),
      scrapeStreamImpl,
    });

    const result = await service.scrape({
      url: "https://www.vidking.net/embed/tv/127529/1/2?autoPlay=true",
      subLang: "en",
      tmdbId: "127529",
      titleType: "series",
      season: 1,
      episode: 2,
    });

    expect(result?.subtitle).toBeUndefined();
    expect(result?.subtitleSource).toBe("none");
    expect(result?.subtitleList).toHaveLength(0);
    expect(scrapeStreamImpl).toHaveBeenCalledTimes(1);
  });
});
