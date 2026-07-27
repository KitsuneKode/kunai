import { afterEach, expect, test } from "bun:test";

import { createHistoryKey, HistoryRepository } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterEach(() => {
  stores.cleanup();
});

function repo(): HistoryRepository {
  const db = stores.store("history-youtube", "data");
  return new HistoryRepository(db);
}

test("upsertProgress migrates legacy movie keys to video keys for youtube rows", () => {
  const r = repo();
  const title = {
    id: "youtube:abc123",
    kind: "movie" as const,
    title: "Sample Video",
    externalIds: { youtubeId: "abc123" },
  };

  r.upsertProgress({
    title,
    positionSeconds: 120,
    durationSeconds: 600,
    providerId: "youtube",
    updatedAt: "2026-06-01T00:00:00.000Z",
  });

  expect(r.getProgress(title)?.positionSeconds).toBe(120);

  r.upsertProgress({
    title: { ...title, kind: "video" },
    positionSeconds: 240,
    durationSeconds: 600,
    providerId: "youtube",
    updatedAt: "2026-06-02T00:00:00.000Z",
  });

  const videoKey = createHistoryKey({ ...title, kind: "video" });
  const movieKey = createHistoryKey(title);
  expect(r.getProgressByKey(videoKey)?.positionSeconds).toBe(240);
  expect(r.getProgressByKey(movieKey)).toBeUndefined();
});
