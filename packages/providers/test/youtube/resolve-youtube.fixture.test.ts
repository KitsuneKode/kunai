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

  /**
   * Each configured player client becomes its own source. Clients fail
   * independently — one answers 403 on media URLs while another plays the same
   * video — so this is what lets startup source failover retry a different client
   * instead of ending playback.
   */
  describe("player-client failover lanes", () => {
    function seedMetadataCache() {
      const cache = new Map<string, unknown>();
      const seeded = normalizeYtDlpVideoInfo(
        {
          id: FIXTURE_VIDEO_ID,
          title: "Me at the zoo",
          duration: 19,
          formats: [{ format_id: "18", height: 360, vcodec: "avc1", acodec: "mp4a", tbr: 500 }],
        },
        FIXTURE_VIDEO_ID,
      );
      return {
        get: (videoId: string) => (videoId === FIXTURE_VIDEO_ID ? seeded : cache.get(videoId)),
        set: (videoId: string, info: unknown) => {
          cache.set(videoId, info);
        },
      } as never;
    }

    test("one source per configured client, each carrying only its own client", async () => {
      if (!Bun.which("yt-dlp")) return;
      configureYoutubeProvider({
        metadataCache: seedMetadataCache(),
        extractorArgs: "youtube:player_client=mweb,tv_simply",
      });

      const resolve = youtubeProviderModule.resolve;
      if (!resolve) throw new Error("YouTube provider resolve adapter is not configured");
      const result = await resolve(buildResolveInput(), TEST_CONTEXT);

      expect(result.status).toBe("resolved");
      expect(result.sources.map((source) => source.id)).toEqual([
        "source:youtube:mweb",
        "source:youtube:tv_simply",
      ]);
      // Exactly one selected lane; the rest are failover candidates.
      expect(result.sources.filter((source) => source.status === "selected")).toHaveLength(1);

      const args = result.streams.map(
        (stream) => (stream.metadata as { extractorArgs?: string }).extractorArgs,
      );
      expect(args).toContain("youtube:player_client=mweb");
      expect(args).toContain("youtube:player_client=tv_simply");
      // A lane must never carry the full multi-client list, or failover is a no-op.
      expect(args.some((value) => value?.includes(","))).toBe(false);
    });

    test("each quality variant lists every lane so a chosen quality can still fail over", async () => {
      if (!Bun.which("yt-dlp")) return;
      configureYoutubeProvider({
        metadataCache: seedMetadataCache(),
        extractorArgs: "youtube:player_client=mweb,tv_simply",
      });

      const resolve = youtubeProviderModule.resolve;
      if (!resolve) throw new Error("YouTube provider resolve adapter is not configured");
      const result = await resolve(buildResolveInput(), TEST_CONTEXT);

      expect(result.variants?.length).toBeGreaterThan(0);
      for (const variant of result.variants ?? []) {
        expect(variant.streamIds).toHaveLength(2);
        expect(new Set(variant.streamIds).size).toBe(2);
      }
    });

    test("a single configured client stays a single source", async () => {
      if (!Bun.which("yt-dlp")) return;
      configureYoutubeProvider({
        metadataCache: seedMetadataCache(),
        extractorArgs: "youtube:player_client=mweb",
      });

      const resolve = youtubeProviderModule.resolve;
      if (!resolve) throw new Error("YouTube provider resolve adapter is not configured");
      const result = await resolve(buildResolveInput(), TEST_CONTEXT);

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]?.id).toBe("source:youtube:mweb");
    });
  });
});
