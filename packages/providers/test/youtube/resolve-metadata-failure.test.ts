import { afterEach, describe, expect, test } from "bun:test";

import {
  configureYoutubeProvider,
  normalizeYtDlpVideoInfo,
  toYoutubeVideoCatalogId,
  youtubeProviderModule,
} from "@kunai/providers/youtube";
import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

const TEST_CONTEXT: ProviderRuntimeContext = {
  providerId: "youtube",
  now: () => new Date().toISOString(),
};

const VIDEO_ID = "jNQXAC9IVRw";

// The resolve path requires the binary even though every test injects its
// metadata service — presence is the whole contract. skipIf keeps absence a
// visible skip instead of a vacuous pass (#468).
const hasYtDlp = () => Boolean(Bun.which("yt-dlp"));
const ytdlpTest = test.skipIf(!hasYtDlp());

function buildInput(qualityPreference = "best"): ProviderResolveInput {
  return {
    title: {
      id: toYoutubeVideoCatalogId(VIDEO_ID),
      kind: "video",
      title: "Me at the zoo",
      externalIds: { youtubeId: VIDEO_ID },
    },
    mediaKind: "video",
    preferredSubtitleLanguage: "en",
    qualityPreference,
    intent: "play",
    allowedRuntimes: ["direct-http"],
  } as ProviderResolveInput;
}

/** A metadata service whose fetch always rejects with the given yt-dlp stderr. */
function failingService(stderr: string) {
  return {
    get: () => null,
    getOrFetch: async () => {
      throw new Error(stderr);
    },
  };
}

function resolveYoutube(input: ProviderResolveInput) {
  const resolve = youtubeProviderModule.resolve;
  if (!resolve) throw new Error("YouTube provider resolve adapter is not configured");
  return resolve(input, TEST_CONTEXT);
}

afterEach(() => {
  configureYoutubeProvider({});
});

describe("youtube resolve on metadata failure", () => {
  ytdlpTest("a members-only video fails closed instead of resolving into mpv", async () => {
    configureYoutubeProvider({
      metadataService: failingService(
        "ERROR: [youtube] abc: Join this channel to get access to members-only content",
      ),
    });

    const result = await resolveYoutube(buildInput());

    expect(result.status).not.toBe("resolved");
    expect(result.streams).toHaveLength(0);
    const failure = result.failures.at(-1);
    expect(failure?.code).toBe("blocked");
    expect(failure?.retryable).toBe(false);
    expect(failure?.message).toContain("members-only");
  });

  ytdlpTest("a private video reports why, not a generic parse failure", async () => {
    configureYoutubeProvider({
      metadataService: failingService(
        "ERROR: [youtube] abc: Private video. Sign in if you've been granted access",
      ),
    });

    const result = await resolveYoutube(buildInput());
    expect(result.status).not.toBe("resolved");
    expect(result.failures.at(-1)?.message).toContain("private");
  });

  ytdlpTest(
    "a transient failure still resolves, so a flaky probe cannot kill playback",
    async () => {
      configureYoutubeProvider({
        metadataService: failingService("ERROR: unable to download webpage: HTTP Error 503"),
      });

      const result = await resolveYoutube(buildInput());
      expect(result.status).toBe("resolved");
      expect(result.streams.length).toBeGreaterThan(0);
      expect(result.failures.at(-1)?.retryable).toBe(true);
    },
  );

  ytdlpTest(
    "a transient failure keeps the quality ceiling instead of asking for best",
    async () => {
      configureYoutubeProvider({
        metadataService: failingService("ERROR: unable to download webpage: HTTP Error 503"),
      });

      const result = await resolveYoutube(buildInput("720p"));
      const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
      expect(selected?.qualityLabel).toBe("720p");
      // The ceiling has to reach yt-dlp, not just the label.
      expect(String(selected?.metadata?.ytdlFormat)).toContain("height<=?720");
      expect(selected?.metadata?.metadataUnavailable).toBe(true);
    },
  );

  ytdlpTest("a requested quality absent from the ladder rounds down, not up", async () => {
    const seeded = normalizeYtDlpVideoInfo(
      {
        id: VIDEO_ID,
        title: "Me at the zoo",
        duration: 19,
        formats: [
          { format_id: "137", height: 1080, vcodec: "avc1", acodec: "none", tbr: 4000 },
          { format_id: "135", height: 480, vcodec: "avc1", acodec: "mp4a", tbr: 1200 },
        ],
      },
      VIDEO_ID,
    );
    configureYoutubeProvider({
      metadataService: { get: () => seeded, getOrFetch: async () => seeded },
    });

    const result = await resolveYoutube(buildInput("720p"));
    const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
    expect(selected?.qualityLabel).toBe("480p");
  });
});

ytdlpTest("resolving without any metadata service flags the streams as unverified", async () => {
  // No metadataService configured: loadYtDlpVideoInfo returns null without
  // throwing, so nothing else would mark the ladder unverified.
  configureYoutubeProvider({});

  const result = await resolveYoutube(buildInput());
  expect(result.status).toBe("resolved");
  const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
  expect(selected?.metadata?.metadataUnavailable).toBe(true);
});
