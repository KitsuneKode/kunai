import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { clearRivestreamCachesForTest, rivestreamProviderModule } from "../src/rivestream/direct";

const MASTER_URL = "https://proxy.example/m3u8-proxy?url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8";

/** Trimmed from the live master (2026-09-12): three muxed-audio variants. */
const MUXED_MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=661118,CODECS="mp4a.40.2,avc1.42c015",RESOLUTION=640x256
https://proxy.example/v0.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2191399,CODECS="mp4a.40.2,avc1.64001f",RESOLUTION=1280x512
https://proxy.example/v1.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3652287,CODECS="mp4a.40.2,avc1.640028",RESOLUTION=1920x768
https://proxy.example/v2.m3u8
`;

const INPUT = {
  title: { id: "438631", tmdbId: "438631", kind: "movie", title: "Dune" },
  mediaKind: "movie",
  intent: "play",
  startupPriority: "balanced",
  allowedRuntimes: ["direct-http"],
} as unknown as ProviderResolveInput;

function context(options: {
  readonly master?: string | "fail";
  readonly quality?: string;
  readonly onMaster?: (signal: AbortSignal | undefined) => void;
}): ProviderRuntimeContext {
  return {
    providerId: "rivestream",
    now: () => "2026-09-12T00:00:00.000Z",
    fetch: {
      runtime: "direct-http",
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("VideoProviderServices")) {
          return Response.json({ data: ["flowcast"] });
        }
        if (url === MASTER_URL) {
          options.onMaster?.(init?.signal ?? undefined);
          if (options.master === "fail") throw new TypeError("fetch failed");
          return new Response(options.master ?? MUXED_MASTER);
        }
        return Response.json({
          data: {
            sources: [{ url: MASTER_URL, quality: options.quality ?? "FlowCast", format: "hls" }],
          },
        });
      },
    },
  } as unknown as ProviderRuntimeContext;
}

describe("rivestream hands mpv one variant, not the master", () => {
  // Leave the process-wide services cache as this file found it.
  beforeEach(() => clearRivestreamCachesForTest());
  afterEach(() => clearRivestreamCachesForTest());

  test("splits a muxed master into its rungs, best first", async () => {
    // A master makes ffmpeg load and probe every variant before playing one:
    // 19.1s to a first frame against 11.2s for a single variant, live.
    const result = await rivestreamProviderModule.resolve(INPUT, context({}));

    expect(result.status).toBe("resolved");
    expect(result.streams.map((stream) => stream.qualityLabel)).toEqual(["768p", "512p", "256p"]);
    expect(result.streams.every((stream) => stream.url !== MASTER_URL)).toBe(true);
  });

  test("keeps the audio language the provider's quality string names", async () => {
    // The language is read from "German (1080)"; a rung label would erase it.
    const result = await rivestreamProviderModule.resolve(
      INPUT,
      context({ quality: "German (1080)" }),
    );

    expect(result.streams.length).toBe(3);
    expect(result.streams.every((stream) => stream.audioLanguages?.[0] === "de")).toBe(true);
  });

  test("a master whose variants need a separate audio track stays whole", async () => {
    const withAudioGroup = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",URI="https://proxy.example/a.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=3652287,RESOLUTION=1920x768,AUDIO="a"
https://proxy.example/v2.m3u8
`;
    const result = await rivestreamProviderModule.resolve(
      INPUT,
      context({ master: withAudioGroup }),
    );

    expect(result.streams.map((stream) => stream.url)).toEqual([MASTER_URL]);
  });

  test("a proxy that fails the master request plays the master as before", async () => {
    const result = await rivestreamProviderModule.resolve(INPUT, context({ master: "fail" }));

    expect(result.status).toBe("resolved");
    expect(result.streams.map((stream) => stream.url)).toEqual([MASTER_URL]);
  });

  test("the master request carries a deadline, so a stalled proxy cannot hold resolve open", async () => {
    // Asserted on the request rather than by waiting it out: a test that needs
    // real elapsed time to pass is the flake this repo keeps removing.
    const signals: (AbortSignal | undefined)[] = [];
    await rivestreamProviderModule.resolve(
      INPUT,
      context({ onMaster: (signal) => signals.push(signal) }),
    );

    expect(signals.length).toBe(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]?.aborted).toBe(false);
  });
});
