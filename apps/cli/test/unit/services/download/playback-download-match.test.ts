import { describe, expect, test } from "bun:test";

import {
  formatPlaybackDownloadStripe,
  pickActiveDownloadForPlayback,
} from "@/services/download/playback-download-match";
import type { DownloadJobRecord } from "@kunai/storage";

function job(
  partial: Partial<DownloadJobRecord> & Pick<DownloadJobRecord, "id" | "titleId">,
): DownloadJobRecord {
  return {
    titleName: "T",
    mediaKind: "series",
    providerId: "p",
    streamUrl: "https://x",
    headers: {},
    status: "queued",
    progressPercent: 0,
    outputPath: "/o.mp4",
    tempPath: "/t.tmp",
    retryCount: 0,
    attempt: 0,
    maxAttempts: 3,
    createdAt: "c",
    updatedAt: "u",
    ...partial,
  };
}

describe("pickActiveDownloadForPlayback", () => {
  test("picks the episode-specific job when season/episode match", () => {
    const jobs = [
      job({
        id: "1",
        titleId: "show",
        season: 1,
        episode: 1,
        status: "running",
        progressPercent: 10,
      }),
      job({
        id: "2",
        titleId: "show",
        season: 1,
        episode: 2,
        status: "queued",
        progressPercent: 0,
      }),
    ];
    const picked = pickActiveDownloadForPlayback(jobs, {
      titleId: "show",
      contentType: "series",
      season: 1,
      episode: 2,
    });
    expect(picked?.id).toBe("2");
  });

  test("falls back to the first title match when episode is omitted", () => {
    const jobs = [
      job({ id: "a", titleId: "show", season: 1, episode: 9, status: "queued" }),
      job({
        id: "b",
        titleId: "show",
        season: 2,
        episode: 1,
        status: "running",
        progressPercent: 5,
      }),
    ];
    const picked = pickActiveDownloadForPlayback(jobs, {
      titleId: "show",
      contentType: "series",
    });
    expect(picked?.id).toBe("a");
  });

  test("movie matches any job for the title", () => {
    const jobs = [
      job({ id: "m", titleId: "film", mediaKind: "movie", status: "running", progressPercent: 2 }),
    ];
    const picked = pickActiveDownloadForPlayback(jobs, {
      titleId: "film",
      contentType: "movie",
    });
    expect(picked?.id).toBe("m");
  });
});

describe("formatPlaybackDownloadStripe", () => {
  test("formats running progress", () => {
    const line = formatPlaybackDownloadStripe(
      job({
        id: "1",
        titleId: "x",
        season: 2,
        episode: 3,
        status: "running",
        progressPercent: 44,
      }),
    );
    expect(line).toBe("S02E03  ·  downloading 44%");
  });
});
