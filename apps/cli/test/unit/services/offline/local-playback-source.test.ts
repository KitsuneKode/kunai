import { describe, expect, test } from "bun:test";

import { buildLocalPlaybackSource } from "@/services/offline/local-playback-source";
import type { DownloadJobRecord } from "@kunai/storage";

function job(patch: Partial<DownloadJobRecord> & Pick<DownloadJobRecord, "id">): DownloadJobRecord {
  return {
    titleId: "t",
    titleName: "Demo",
    mediaKind: "series",
    providerId: "p",
    streamUrl: "https://x",
    headers: {},
    status: "completed",
    progressPercent: 100,
    outputPath: "/downloads/demo.mp4",
    tempPath: "/downloads/demo.tmp",
    retryCount: 0,
    attempt: 1,
    maxAttempts: 3,
    createdAt: "a",
    updatedAt: "b",
    completedAt: "c",
    ...patch,
  };
}

describe("buildLocalPlaybackSource", () => {
  test.each(["movie", "series", "anime", "video"] as const)(
    "preserves the persisted %s media kind unchanged",
    (mediaKind) => {
      expect(buildLocalPlaybackSource(job({ id: "1", mediaKind }), null).mediaKind).toBe(mediaKind);
    },
  );

  test("keeps the persisted position facts exactly as stored", () => {
    const source = buildLocalPlaybackSource(
      job({ id: "1", mediaKind: "movie", season: 1, episode: 1 }),
      null,
    );
    expect(source.season).toBe(1);
    expect(source.episode).toBe(1);
    expect(source.mediaKind).toBe("movie");
  });

  test("carries identity, file and quality facts through unchanged", () => {
    const source = buildLocalPlaybackSource(
      job({
        id: "job-1",
        titleId: "frieren",
        titleName: "Frieren",
        mediaKind: "anime",
        episode: 3,
        providerEpisodeIdentity: { providerId: "allanime", value: "OVA" },
        outputPath: "/downloads/frieren-e03.mkv",
        subtitlePath: "/downloads/frieren-e03.srt",
        subtitleLanguage: "en",
        selectedQualityLabel: "1080p",
        animeLang: "sub",
      }),
      null,
    );
    expect(source).toMatchObject({
      kind: "local",
      jobId: "job-1",
      titleId: "frieren",
      titleName: "Frieren",
      mediaKind: "anime",
      episode: 3,
      providerEpisodeIdentity: { providerId: "allanime", value: "OVA" },
      filePath: "/downloads/frieren-e03.mkv",
      subtitlePath: "/downloads/frieren-e03.srt",
      subtitleLanguage: "en",
      qualityLabel: "1080p",
      audioMode: "sub",
    });
  });
});
