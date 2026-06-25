import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createHistoryKey,
  HistoryRepository,
  openKunaiDatabase,
  runMigrations,
} from "../src/index";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function repo(): HistoryRepository {
  const dir = mkdtempSync(join(tmpdir(), "kunai-history-youtube-"));
  tempDirs.push(dir);
  const db = openKunaiDatabase(join(dir, "data.sqlite"));
  runMigrations(db, "data");
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
