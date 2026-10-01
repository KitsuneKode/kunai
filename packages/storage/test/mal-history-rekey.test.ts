import { afterAll, expect, test } from "bun:test";

import { dataMigrations, DownloadJobsRepository, HistoryRepository } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterAll(() => {
  stores.cleanup();
});

test("bare MAL history keys move to mal: and AniList keys stay put", () => {
  const db = stores.store("mal-rekey", "data");
  const now = "2026-10-01T00:00:00.000Z";
  const insert = db.query(
    `INSERT INTO history_progress (
      key, title_id, media_kind, title, season, episode, absolute_episode,
      position_seconds, duration_seconds, completed, watched_seconds,
      last_watched_at, completed_at, provider_id, external_ids_json, poster_url,
      updated_at, created_at
    ) VALUES (?, ?, 'anime', ?, 1, 1, NULL, ?, 1000, 0, ?, NULL, NULL, 'allmanga', ?, NULL, ?, ?)`,
  );
  insert.run(
    "anime:16498:1:1:none",
    "16498",
    "MAL only",
    10,
    10,
    JSON.stringify({ malId: "16498" }),
    now,
    now,
  );
  insert.run(
    "anime:16498:1:2:none",
    "16498",
    "AniList",
    40,
    40,
    JSON.stringify({ anilistId: "16498", malId: "16498" }),
    now,
    now,
  );
  insert.run(
    "anime:mal:16498:1:1:none",
    "mal:16498",
    "Already namespaced",
    100,
    100,
    JSON.stringify({ malId: "16498" }),
    now,
    now,
  );
  insert.run(
    "anime:20:1:1:none",
    "20",
    "MAL follow",
    5,
    5,
    JSON.stringify({ malId: "20" }),
    now,
    now,
  );
  db.query(
    `INSERT INTO followed_titles (title_id, media_kind, title, preference, updated_at)
     VALUES ('20', 'anime', 'MAL follow', 'notify', ?)`,
  ).run(now);
  db.query(
    `INSERT INTO followed_titles (title_id, media_kind, title, preference, updated_at)
     VALUES ('16498', 'anime', 'Shared number', 'notify', ?)`,
  ).run(now);
  db.query(
    `INSERT INTO history_title_aliases (alias_ns, alias_id, title_id, created_at, updated_at)
     VALUES ('mal', '20', '20', ?, ?)`,
  ).run(now, now);

  const jobs = new DownloadJobsRepository(db);
  jobs.enqueue({
    id: "job-mal",
    titleId: "20",
    externalIds: { malId: "20" },
    titleName: "MAL follow",
    mediaKind: "anime",
    season: 1,
    episode: 1,
    providerId: "allmanga",
    mode: "anime",
    streamUrl: "https://example.test/a",
    headers: {},
    outputPath: "/tmp/mal.mp4",
    tempPath: "/tmp/mal.mp4.part",
    createdAt: now,
    updatedAt: now,
  });

  const migration = dataMigrations.find(
    (entry) => entry.id === "042_data_namespace_mal_history_keys",
  );
  if (!migration) throw new Error("missing MAL rekey migration");
  db.exec(migration.sql);
  db.exec(migration.sql);

  const history = new HistoryRepository(db);
  const rows = history.listAllProgress();
  const malEpisode = rows.find((row) => row.title === "MAL only");
  const anilistEpisode = rows.find((row) => row.title === "AniList");
  const merged = rows.find((row) => row.title === "Already namespaced");
  expect(malEpisode).toBeUndefined();
  expect(merged?.titleId).toBe("mal:16498");
  expect(merged?.positionSeconds).toBe(100);
  expect(anilistEpisode?.titleId).toBe("16498");
  expect(rows.find((row) => row.title === "MAL follow")?.titleId).toBe("mal:20");
  expect(rows.find((row) => row.title === "MAL follow")?.key).toBe("anime:mal:20:1:1:none");

  const follows = db
    .query<{ title_id: string }, []>("SELECT title_id FROM followed_titles ORDER BY title_id")
    .all()
    .map((row) => row.title_id);
  expect(follows).toContain("mal:20");
  expect(follows).toContain("16498");
  expect(jobs.get("job-mal")?.titleId).toBe("mal:20");
  const alias = db
    .query<{ title_id: string }, [string]>(
      "SELECT title_id FROM history_title_aliases WHERE alias_ns = 'mal' AND alias_id = ?",
    )
    .get("20");
  expect(alias?.title_id).toBe("mal:20");
});
