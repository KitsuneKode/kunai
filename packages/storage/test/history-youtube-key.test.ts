import { afterEach, expect, test } from "bun:test";

import { createHistoryKey, HistoryRepository } from "../src/index";
import type { KunaiDatabase } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterEach(() => {
  stores.cleanup();
});

function repo(): HistoryRepository {
  const db = stores.store("history-youtube", "data");
  return new HistoryRepository(db);
}

function repoWithDb(name: string): {
  readonly repo: HistoryRepository;
  readonly db: KunaiDatabase;
} {
  const db = stores.store(name, "data");
  return { repo: new HistoryRepository(db), db };
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

const YOUTUBE_TITLE = {
  id: "youtube:abc123",
  kind: "movie" as const,
  title: "Sample Video",
  externalIds: { youtubeId: "abc123" },
};

test("a failed canonical write leaves the legacy row and its aliases intact", () => {
  // The legacy `movie` row is DELETEd before the canonical `video` row is
  // inserted. Those are one atomic step or they are data loss: if the insert
  // fails after the delete lands, the user's resume position is simply gone and
  // nothing is left to recover it from.
  //
  // The failure is injected with a trigger rather than a stubbed method so the
  // rollback being asserted is SQLite's own, across the same statements
  // production runs — a fake `query` would prove only that the fake threw.
  const { repo: r, db } = repoWithDb("history-youtube-rollback");

  r.upsertProgress({
    title: YOUTUBE_TITLE,
    positionSeconds: 120,
    durationSeconds: 600,
    providerId: "youtube",
    updatedAt: "2026-06-01T00:00:00.000Z",
  });

  const legacyKey = createHistoryKey(YOUTUBE_TITLE);
  const videoKey = createHistoryKey({ ...YOUTUBE_TITLE, kind: "video" });
  const aliasesBefore = db.query("SELECT COUNT(*) AS n FROM history_title_aliases").get() as {
    n: number;
  };

  db.query(
    `CREATE TRIGGER reject_canonical_insert
     BEFORE INSERT ON history_progress
     WHEN NEW.key = '${videoKey}'
     BEGIN SELECT RAISE(ABORT, 'injected canonical insert failure'); END`,
  ).run();

  expect(() =>
    r.upsertProgress({
      title: { ...YOUTUBE_TITLE, kind: "video" },
      positionSeconds: 240,
      durationSeconds: 600,
      providerId: "youtube",
      updatedAt: "2026-06-02T00:00:00.000Z",
    }),
  ).toThrow();

  db.query("DROP TRIGGER reject_canonical_insert").run();

  // The legacy row survived the delete, with its original progress.
  expect(r.getProgressByKey(legacyKey)?.positionSeconds).toBe(120);
  // No half-migrated canonical row.
  expect(r.getProgressByKey(videoKey)).toBeUndefined();
  // And no alias committed for a row that does not exist.
  const aliasesAfter = db.query("SELECT COUNT(*) AS n FROM history_title_aliases").get() as {
    n: number;
  };
  expect(aliasesAfter.n).toBe(aliasesBefore.n);
});

test("a successful migration leaves exactly one row, keeping accumulated fields and aliases", () => {
  const { repo: r, db } = repoWithDb("history-youtube-success");

  r.upsertProgress({
    title: YOUTUBE_TITLE,
    positionSeconds: 120,
    durationSeconds: 600,
    // Higher than anything the second write derives from its position, so the
    // assertion below proves the accumulated value crossed the key change
    // rather than being recomputed on the far side.
    watchedSeconds: 500,
    posterUrl: "https://img.example/abc123.jpg",
    providerId: "youtube",
    updatedAt: "2026-06-01T00:00:00.000Z",
  });

  r.upsertProgress({
    title: { ...YOUTUBE_TITLE, kind: "video" },
    positionSeconds: 240,
    durationSeconds: 600,
    providerId: "youtube",
    updatedAt: "2026-06-02T00:00:00.000Z",
  });

  const rows = db
    .query("SELECT key FROM history_progress WHERE title_id = ?")
    .all("youtube:abc123") as { key: string }[];
  expect(rows).toHaveLength(1);
  expect(rows[0]?.key).toBe(createHistoryKey({ ...YOUTUBE_TITLE, kind: "video" }));

  const migrated = r.getProgressByKey(createHistoryKey({ ...YOUTUBE_TITLE, kind: "video" }));
  expect(migrated?.positionSeconds).toBe(240);
  // `watched_seconds` is monotonic (`max(prior, fromPosition)`), so the legacy
  // row's 500 survives the rekey instead of being reset to the 240 this write
  // would have derived on its own.
  expect(migrated?.watchedSeconds).toBe(500);
  expect(migrated?.posterUrl).toBe("https://img.example/abc123.jpg");

  // The youtube alias still resolves to the same unit after the rekey.
  const aliases = db
    .query("SELECT title_id FROM history_title_aliases WHERE alias_ns = 'youtube'")
    .all() as { title_id: string }[];
  expect(aliases.map((row) => row.title_id)).toContain("youtube:abc123");
});
