import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";

import { providerCycleCandidateTimeoutMs } from "@kunai/core";
import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import {
  clearRivestreamCachesForTest,
  rivestreamProviderModule,
  RIVESTREAM_CANDIDATE_TIMEOUT_MS,
  RIVESTREAM_SOURCE_TIMEOUT_MS,
} from "../src/rivestream/direct";

/**
 * The cycle timer and the scraper's own deadline are both real clocks.
 * Tests advance them; nothing here waits on wall time.
 */
const NOW = "2026-09-09T00:00:00.000Z";
const SCRAPER_DELAY_MS = 1_200;
const MEDIA_PLAYLIST = "#EXTM3U\n#EXTINF:4.0,\nsegment-0.ts\n";

const SERIES_INPUT: ProviderResolveInput = {
  title: { id: "1396", tmdbId: "1396", kind: "series", title: "Breaking Bad" },
  episode: { season: 1, episode: 1 },
  mediaKind: "series",
  startupPriority: "fast",
  intent: "play",
  allowedRuntimes: ["direct-http"],
};

function jsonResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sourcePayload(url: string) {
  return {
    data: {
      sources: [{ url, quality: "1080", format: "hls" }],
      captions: [],
    },
  };
}

function segmentBody(): Uint8Array {
  return new Uint8Array(2_048);
}

/** Stay pending until `signal` aborts, then reject with that abort's reason. */
function hangUntilAbort(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const fail = () => {
      const reason = signal?.reason;
      reject(
        reason instanceof Error
          ? reason
          : new DOMException("The operation was aborted", "AbortError"),
      );
    };
    if (!signal) return;
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    // sleep-allow: delay() is only advanced by jest fake timers in this file
    setTimeout(resolve, ms);
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let step = 0; step < 80; step += 1) await Promise.resolve();
}

/**
 * Advance the injected clock, then let the promise reactions that a timer
 * callback queued run before the next deadline. Skipping the flush fires the
 * candidate timer in the same turn as the scraper response.
 */
async function advance(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await flushMicrotasks();
}

type RecordedFetch = {
  readonly urls: string[];
  readonly providers: string[];
};

function contextFor(
  mode: "cdn-hang" | "hung-scraper",
  recorded: RecordedFetch,
): ProviderRuntimeContext {
  return {
    now: () => NOW,
    emit: () => {},
    fetch: {
      runtime: "direct-http",
      resolvesLocally: () => false,
      fetch: async (input, init) => {
        const url = String(input);
        recorded.urls.push(url);

        if (url.includes("/api/providers")) {
          return jsonResponse(JSON.stringify({ data: ["slowcdn", "healthy"] }));
        }

        if (url.includes("/api/provider?")) {
          const provider = new URL(url).searchParams.get("provider") ?? "";
          recorded.providers.push(provider);
          if (provider === "slowcdn") {
            if (mode === "hung-scraper") return hangUntilAbort(init?.signal);
            await delay(SCRAPER_DELAY_MS);
            return jsonResponse(
              JSON.stringify(sourcePayload("https://slowcdn.example/index.m3u8")),
            );
          }
          if (provider === "healthy") {
            return jsonResponse(
              JSON.stringify(sourcePayload("https://healthy.example/index.m3u8")),
            );
          }
          return jsonResponse(JSON.stringify({ data: { sources: [], captions: [] } }));
        }

        if (url.includes("slowcdn.example") && url.endsWith(".m3u8")) {
          return new Response(MEDIA_PLAYLIST, { status: 200 });
        }
        if (url.includes("slowcdn.example")) {
          return hangUntilAbort(init?.signal);
        }
        if (url.includes("healthy.example") && url.endsWith(".m3u8")) {
          return new Response(MEDIA_PLAYLIST, { status: 200 });
        }
        if (url.includes("healthy.example")) {
          return new Response(segmentBody(), {
            status: 206,
            headers: { "content-type": "video/mp2t" },
          });
        }
        return new Response("missing", { status: 404 });
      },
    },
  };
}

describe("rivestream scraper timeout vs CDN timeout", () => {
  beforeEach(() => {
    clearRivestreamCachesForTest();
  });

  afterEach(() => {
    if (jest.isFakeTimers()) {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
    clearRivestreamCachesForTest();
  });

  test("a CDN segment hang falls through to the next service", async () => {
    const candidateMs = providerCycleCandidateTimeoutMs("fast", RIVESTREAM_CANDIDATE_TIMEOUT_MS);
    // The repro is the source fetch eating the budget the gate thought it had.
    // An instant scraper lets both probes time out and the gate accept the hang.
    expect(candidateMs).toBeGreaterThan(SCRAPER_DELAY_MS);

    jest.useFakeTimers({ now: Date.parse(NOW) });
    const recorded: RecordedFetch = { urls: [], providers: [] };
    const pending = rivestreamProviderModule.resolve(
      SERIES_INPUT,
      contextFor("cdn-hang", recorded),
    );

    await flushMicrotasks();
    await advance(SCRAPER_DELAY_MS);
    await advance(candidateMs - SCRAPER_DELAY_MS);
    const result = await pending;

    expect(recorded.providers).toContain("slowcdn");
    expect(recorded.providers).toContain("healthy");
    expect(result.status).toBe("resolved");
    expect(result.streams?.some((stream) => stream.url?.includes("healthy.example"))).toBe(true);
    expect(result.streams?.some((stream) => stream.url?.includes("slowcdn.example"))).toBe(false);
    expect(
      recorded.urls.some((url) => url.includes("healthy.example") && url.includes("segment-0.ts")),
    ).toBe(true);
    const classes = (result.trace?.events ?? [])
      .filter((event) => event.type === "source:failed")
      .map((event) => event.attributes?.failureClass);
    expect(classes).toContain("candidate-timeout");
  });

  test("a hung scraper stops the walk before the next service", async () => {
    jest.useFakeTimers({ now: Date.parse(NOW) });
    const recorded: RecordedFetch = { urls: [], providers: [] };
    const pending = rivestreamProviderModule.resolve(
      SERIES_INPUT,
      contextFor("hung-scraper", recorded),
    );

    await flushMicrotasks();
    await advance(RIVESTREAM_SOURCE_TIMEOUT_MS);
    const result = await pending;

    expect(recorded.providers).toEqual(["slowcdn"]);
    expect(result.status).toBe("exhausted");
    expect(result.failures.some((failure) => failure.message.includes("scraper timed out"))).toBe(
      true,
    );
  });
});

describe("rivestream cache buster", () => {
  beforeEach(() => {
    clearRivestreamCachesForTest();
  });

  afterEach(() => {
    clearRivestreamCachesForTest();
  });

  test("only primevids and citadel send cb", async () => {
    const requested: string[] = [];
    const context: ProviderRuntimeContext = {
      now: () => NOW,
      emit: () => {},
      fetch: {
        runtime: "direct-http",
        resolvesLocally: () => false,
        fetch: async (input) => {
          const url = String(input);
          if (url.includes("/api/providers")) {
            return jsonResponse(JSON.stringify({ data: ["apogee", "primevids", "citadel"] }));
          }
          if (url.includes("/api/provider?")) {
            requested.push(url);
            return jsonResponse(JSON.stringify({ data: { sources: [], captions: [] } }));
          }
          return new Response("missing", { status: 404 });
        },
      },
    };

    const result = await rivestreamProviderModule.resolve(
      { ...SERIES_INPUT, startupPriority: "balanced" },
      context,
    );

    expect(result.status).toBe("exhausted");
    const cb = String(Math.floor(Date.parse(NOW) / 3_000_000));
    const byProvider = new Map(
      requested.map((url) => {
        const params = new URL(url).searchParams;
        return [params.get("provider"), params.get("cb")] as const;
      }),
    );
    expect(byProvider.get("apogee")).toBeNull();
    expect(byProvider.get("primevids")).toBe(cb);
    expect(byProvider.get("citadel")).toBe(cb);
    expect([...byProvider.keys()].sort()).toEqual(["apogee", "citadel", "primevids"]);
  });
});
