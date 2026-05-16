import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cacheOfflinePosterArtwork,
  resolveOfflinePosterArtifactPath,
} from "@/services/offline/offline-artwork-cache";
import type { DownloadJobRecord } from "@kunai/storage";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

function createJob(outputPath: string, posterUrl?: string): DownloadJobRecord {
  return {
    id: "job-1",
    titleId: "title-1",
    titleName: "Title",
    mediaKind: "movie",
    providerId: "vidking",
    streamUrl: "https://cdn.example/stream.m3u8",
    headers: {},
    status: "completed",
    progressPercent: 100,
    outputPath,
    tempPath: `${outputPath}.part`,
    posterUrl,
    retryCount: 0,
    attempt: 0,
    maxAttempts: 3,
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:00.000Z",
  };
}

describe("offline artwork cache", () => {
  test("caches remote poster artwork beside the downloaded video", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-artwork-"));
    tempDirs.push(dir);
    const job = createJob(join(dir, "Movie.mp4"), "https://img.example/poster.png");

    const path = await cacheOfflinePosterArtwork({
      job,
      fetchImpl: async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    });

    expect(path).toBe(resolveOfflinePosterArtifactPath(job));
    expect((await stat(path ?? "")).size).toBe(3);
  });

  test("does not cache non-image poster responses", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-artwork-"));
    tempDirs.push(dir);
    const job = createJob(join(dir, "Movie.mp4"), "https://img.example/poster.txt");

    const path = await cacheOfflinePosterArtwork({
      job,
      fetchImpl: async () =>
        new Response("not image", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    });

    expect(path).toBeNull();
  });

  test("dedupes concurrent poster cache work for the same artifact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-artwork-"));
    tempDirs.push(dir);
    const job = createJob(join(dir, "Movie.mp4"), "https://img.example/poster.webp");
    let fetchCount = 0;

    const [first, second] = await Promise.all([
      cacheOfflinePosterArtwork({
        job,
        fetchImpl: async () => {
          fetchCount += 1;
          await Bun.sleep(5);
          return new Response(new Uint8Array([1, 2, 3, 4]), {
            status: 200,
            headers: { "content-type": "image/webp" },
          });
        },
      }),
      cacheOfflinePosterArtwork({
        job,
        fetchImpl: async () => {
          fetchCount += 1;
          return new Response(new Uint8Array([9]), {
            status: 200,
            headers: { "content-type": "image/webp" },
          });
        },
      }),
    ]);

    expect(first).toBe(resolveOfflinePosterArtifactPath(job));
    expect(second).toBe(first);
    expect(fetchCount).toBe(1);
    expect((await stat(first ?? "")).size).toBe(4);
  });
});
