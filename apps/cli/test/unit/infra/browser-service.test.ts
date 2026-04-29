import { describe, expect, mock, test } from "bun:test";

import { BrowserServiceImpl } from "@/infra/browser/BrowserServiceImpl";
import type { Logger } from "@/infra/logger/Logger";
import type { Tracer } from "@/infra/tracer/Tracer";
import type { CacheStore } from "@/services/persistence/CacheStore";
import type { ConfigService, KitsuneConfig } from "@/services/persistence/ConfigService";
import type { DiagnosticsStore } from "@/services/diagnostics/DiagnosticsStore";

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
    async span<T>(_name: string, fn: (span: Parameters<Parameters<Tracer["span"]>[1]>[0]) => Promise<T>): Promise<T> {
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
  test("refreshes cached subtitles through wyzie without relaunching the browser", async () => {
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
    const resolveSubtitlesByTmdbIdImpl = mock(async () => ({
      list: [
        {
          id: "1",
          url: "https://sub.wyzie.io/c/demo/id/1?format=srt",
          language: "en",
          display: "English",
          release: "Demo.S01E02",
        },
      ],
      selected: "https://sub.wyzie.io/c/demo/id/1?format=srt",
      failed: false,
    }));

    const service = new BrowserServiceImpl({
      logger: createLogger(),
      tracer: createTracer(),
      config: createConfig(),
      cacheStore,
      diagnosticsStore: createDiagnosticsStore(),
      scrapeStreamImpl,
      resolveSubtitlesByTmdbIdImpl,
    });

    const result = await service.scrape({
      url: "https://www.vidking.net/embed/tv/127529/1/2?autoPlay=true",
      subLang: "en",
      tmdbId: "127529",
      titleType: "series",
      season: 1,
      episode: 2,
    });

    expect(result?.subtitle).toBe("https://sub.wyzie.io/c/demo/id/1?format=srt");
    expect(result?.subtitleSource).toBe("wyzie");
    expect(resolveSubtitlesByTmdbIdImpl).toHaveBeenCalledTimes(1);
    expect(scrapeStreamImpl).toHaveBeenCalledTimes(0);
    expect(cacheSet).toHaveBeenCalledTimes(1);
  });
});
