import { describe, expect, test } from "bun:test";

import {
  configureYoutubeProvider,
  getYoutubeProviderConfig,
  normalizeYtDlpVideoInfo,
  toYoutubeVideoCatalogId,
  youtubeProviderModule,
} from "@kunai/providers/youtube";
import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

const TEST_CONTEXT: ProviderRuntimeContext = {
  providerId: "youtube",
  now: () => new Date().toISOString(),
};

const FIXTURE_VIDEO_ID = "jNQXAC9IVRw";

function buildResolveInput(): ProviderResolveInput {
  return {
    title: {
      id: toYoutubeVideoCatalogId(FIXTURE_VIDEO_ID),
      kind: "video",
      title: "Me at the zoo",
      externalIds: { youtubeId: FIXTURE_VIDEO_ID },
    },
    mediaKind: "video",
    preferredSubtitleLanguage: "en",
    qualityPreference: "best",
    intent: "play",
    allowedRuntimes: ["direct-http"],
  };
}

describe("resolveYoutube", () => {
  test("configureYoutubeProvider replaces previous runtime config", () => {
    configureYoutubeProvider({
      cookiesFromBrowser: "chrome",
      sponsorblockRemove: "sponsor,intro",
    });
    configureYoutubeProvider({});

    expect(getYoutubeProviderConfig().cookiesFromBrowser).toBeUndefined();
    expect(getYoutubeProviderConfig().sponsorblockRemove).toBeUndefined();
  });

  test("returns yt-dlp-missing when yt-dlp is absent", async () => {
    if (Bun.which("yt-dlp")) {
      return;
    }

    const resolve = youtubeProviderModule.resolve;
    if (!resolve) throw new Error("YouTube provider resolve adapter is not configured");

    const result = await resolve(buildResolveInput(), TEST_CONTEXT);
    expect(result.status).not.toBe("resolved");
    expect(result.failures.some((failure) => failure.code === "yt-dlp-missing")).toBe(true);
  });

  test("resolves watch URL candidates with requiresYtdl from metadata cache", async () => {
    if (!Bun.which("yt-dlp")) {
      return;
    }

    const cache = new Map<string, unknown>();
    configureYoutubeProvider({
      metadataCache: {
        get: (videoId) => cache.get(videoId) as never,
        set: (videoId, info) => {
          cache.set(videoId, info);
        },
      },
    });
    cache.set(
      FIXTURE_VIDEO_ID,
      normalizeYtDlpVideoInfo(
        {
          id: FIXTURE_VIDEO_ID,
          title: "Me at the zoo",
          duration: 19,
          formats: [
            { format_id: "18", height: 360, vcodec: "avc1", acodec: "mp4a", tbr: 500 },
            { format_id: "22", height: 720, vcodec: "avc1", acodec: "mp4a", tbr: 2000 },
          ],
        },
        FIXTURE_VIDEO_ID,
      ),
    );

    const resolve = youtubeProviderModule.resolve;
    if (!resolve) throw new Error("YouTube provider resolve adapter is not configured");

    const result = await resolve(buildResolveInput(), TEST_CONTEXT);
    expect(result.status).toBe("resolved");
    const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
    expect(selected?.url).toContain("youtube.com/watch");
    expect(selected?.requiresYtdl).toBe(true);
    expect(result.streams.length).toBeGreaterThan(0);
  });
});
