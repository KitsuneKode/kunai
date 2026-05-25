import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { StreamInfo } from "@/domain/types";
import { materializeDeferredMediaForPlayback } from "@/infra/player/deferred-media-materializer";
import { registerAllMangaAkDeferredDescriptor } from "@kunai/providers";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("deferred media materializer", () => {
  test("materializes an AllManga Ak locator into a temporary MPD and cleans it up", async () => {
    const locator = registerAllMangaAkDeferredDescriptor({
      duration: 120,
      video: {
        url: "https://ak-video.example/video.mp4?sig=test-video",
        mimeType: "video/mp4",
        codecs: "avc1.640028",
        width: 1920,
        height: 1080,
        bandwidth: 5200000,
        frameRate: "24000/1001",
        indexRange: "1000-1400",
        initializationRange: "0-999",
      },
      audio: {
        url: "https://ak-audio.example/audio.mp4?sig=test-audio",
        mimeType: "audio/mp4",
        codecs: "mp4a.40.2",
        bandwidth: 128000,
        audioSamplingRate: 48000,
        language: "ja",
        indexRange: "700-900",
        initializationRange: "0-699",
      },
    });
    const stream: StreamInfo = {
      url: locator,
      deferredLocator: locator,
      headers: {},
      title: "Ak Test",
      timestamp: Date.now(),
    };

    const materialized = await materializeDeferredMediaForPlayback(stream);
    cleanup.push(materialized.cleanup);

    expect(materialized.stream.url.endsWith(".mpd")).toBe(true);
    expect(materialized.stream.deferredLocator).toBe(locator);
    expect(existsSync(materialized.stream.url)).toBe(true);

    const mpd = await readFile(materialized.stream.url, "utf8");
    expect(mpd).toContain("https://ak-video.example/video.mp4?sig=test-video");
    expect(mpd).toContain("https://ak-audio.example/audio.mp4?sig=test-audio");

    await materialized.cleanup();
    expect(existsSync(materialized.stream.url)).toBe(false);
  });
});
