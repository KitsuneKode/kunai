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
  test("a members-only video fails closed instead of resolving into mpv", async () => {
    if (!Bun.which("yt-dlp")) return;
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

  test("a private video reports why, not a generic parse failure", async () => {
    if (!Bun.which("yt-dlp")) return;
    configureYoutubeProvider({
      metadataService: failingService(
        "ERROR: [youtube] abc: Private video. Sign in if you've been granted access",
      ),
    });

    const result = await resolveYoutube(buildInput());
    expect(result.status).not.toBe("resolved");
    expect(result.failures.at(-1)?.message).toContain("private");
  });

  test("a transient failure still resolves, so a flaky probe cannot kill playback", async () => {
    if (!Bun.which("yt-dlp")) return;
    configureYoutubeProvider({
      metadataService: failingService("ERROR: unable to download webpage: HTTP Error 503"),
    });

    const result = await resolveYoutube(buildInput());
    expect(result.status).toBe("resolved");
    expect(result.streams.length).toBeGreaterThan(0);
    expect(result.failures.at(-1)?.retryable).toBe(true);
  });

  test("a transient failure keeps the quality ceiling instead of asking for best", async () => {
    if (!Bun.which("yt-dlp")) return;
    configureYoutubeProvider({
      metadataService: failingService("ERROR: unable to download webpage: HTTP Error 503"),
    });

    const result = await resolveYoutube(buildInput("720p"));
    const selected = result.streams.find((stream) => stream.id === result.selectedStreamId);
    expect(selected?.qualityLabel).toBe("720p");
    // The ceiling has to reach yt-dlp, not just the label.
    expect(String(selected?.metadata?.ytdlFormat)).toContain("height<=720");
    expect(selected?.metadata?.metadataUnavailable).toBe(true);
  });

  test("a requested quality absent from the ladder rounds down, not up", async () => {
    if (!Bun.which("yt-dlp")) return;
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
