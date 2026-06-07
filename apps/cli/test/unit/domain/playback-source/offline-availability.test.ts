import { describe, expect, test } from "bun:test";

import { buildOfflineAvailabilityIndex } from "@/domain/playback-source/offline-availability";
import type { OfflineAssetRecord } from "@kunai/storage";

const asset = (over: Partial<OfflineAssetRecord>): OfflineAssetRecord =>
  ({
    id: "a",
    identityKey: "k",
    titleId: "t1",
    titleName: "T",
    mediaKind: "anime",
    profileKey: "p",
    filePath: "/f",
    state: "ready",
    ...over,
  }) as OfflineAssetRecord;

describe("offline availability index", () => {
  test("isReady is true only for ready assets matching season/episode", () => {
    const idx = buildOfflineAvailabilityIndex([
      asset({ titleId: "t1", season: 1, episode: 1, state: "ready" }),
      asset({ titleId: "t1", season: 1, episode: 2, state: "missing" }),
    ]);
    expect(idx.isReady("t1", 1, 1)).toBe(true);
    expect(idx.isReady("t1", 1, 2)).toBe(false); // missing, not ready
    expect(idx.isReady("t1", 1, 3)).toBe(false); // absent
    expect(idx.isReady("t2", 1, 1)).toBe(false);
  });

  test("readyCountForTitle counts distinct ready episodes only", () => {
    const idx = buildOfflineAvailabilityIndex([
      asset({ titleId: "t1", season: 1, episode: 1, state: "ready" }),
      asset({ titleId: "t1", season: 1, episode: 2, state: "ready" }),
      asset({ titleId: "t1", season: 1, episode: 2, state: "ready" }), // dupe
      asset({ titleId: "t1", season: 1, episode: 3, state: "invalid-file" }),
      asset({ titleId: "t2", season: 1, episode: 1, state: "ready" }),
    ]);
    expect(idx.readyCountForTitle("t1")).toBe(2);
    expect(idx.readyCountForTitle("t2")).toBe(1);
    expect(idx.readyCountForTitle("t3")).toBe(0);
  });

  test("movies (no season/episode) resolve by title", () => {
    const idx = buildOfflineAvailabilityIndex([
      asset({ titleId: "m1", mediaKind: "movie", state: "ready" }),
    ]);
    expect(idx.isReady("m1")).toBe(true);
    expect(idx.readyCountForTitle("m1")).toBe(1);
  });
});
