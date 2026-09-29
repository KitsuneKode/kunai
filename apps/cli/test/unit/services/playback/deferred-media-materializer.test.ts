import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";

import type { StreamInfo } from "@/domain/types";
import { materializeDeferredMediaForPlayback } from "@/services/playback/deferred-media-materializer";
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

    // The MPD embeds signed upstream URLs — owner-only file and dir. POSIX
    // only: Windows has ACLs, and stat mode bits there don't reflect chmod.
    if (process.platform !== "win32") {
      expect((await stat(materialized.stream.url)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(materialized.stream.url))).mode & 0o777).toBe(0o700);
    }

    await materialized.cleanup();
    expect(existsSync(materialized.stream.url)).toBe(false);
  });
});
