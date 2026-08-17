import { expect, test } from "bun:test";

import {
  dataMigrations,
  ListRepository,
  openKunaiDatabase,
  PlaylistsRepository,
  QueueRepository,
  runMigrations,
} from "../src/index";

test("playlist identity migration preserves legacy queue, playlist, and list rows", () => {
  const db = openKunaiDatabase(":memory:");
  const migrationIndex = dataMigrations.findIndex(
    (migration) => migration.id === "034_data_playlist_identity",
  );
  expect(migrationIndex).toBeGreaterThan(0);
  runMigrations(db, "data", dataMigrations.slice(0, migrationIndex));

  const at = "2026-08-16T00:00:00.000Z";
  db.query(
    `INSERT INTO playback_queue_sessions (id, status, created_at, updated_at)
     VALUES ('session', 'active', ?, ?)`,
  ).run(at, at);
  db.query(
    `INSERT INTO playlist_queue
       (id, title, media_kind, title_id, priority, source, added_at, session_id)
     VALUES ('queue-item', 'Legacy anime', 'anime', 'anilist:1', 0, 'manual', ?, 'session')`,
  ).run(at);
  db.query(
    `INSERT INTO user_playlists (id, name, created_at, updated_at)
     VALUES ('playlist', 'Legacy', ?, ?)`,
  ).run(at, at);
  db.query(
    `INSERT INTO user_playlist_items
       (id, playlist_id, title_id, media_kind, title, sort_order, added_at)
     VALUES ('playlist-item', 'playlist', 'anilist:1', 'anime', 'Legacy anime', 0, ?)`,
  ).run(at);
  db.query(
    `INSERT INTO list_items
       (id, list_id, title_id, media_kind, title, added_at, sort_order)
     VALUES ('list-item', 'watchlist', 'anilist:1', 'anime', 'Legacy anime', ?, 0)`,
  ).run(at);

  runMigrations(db, "data");

  expect(new QueueRepository(db).getById("queue-item")).toMatchObject({
    id: "queue-item",
    title: "Legacy anime",
    mediaKind: "anime",
  });
  expect(new QueueRepository(db).getById("queue-item")?.contentType).toBeUndefined();
  expect(new QueueRepository(db).getById("queue-item")?.externalIds).toBeUndefined();
  expect(new PlaylistsRepository(db).listItems("playlist")).toMatchObject([
    {
      id: "playlist-item",
      title: "Legacy anime",
      mediaKind: "anime",
      contentType: undefined,
      externalIds: undefined,
    },
  ]);
  expect(new ListRepository(db).getItems("watchlist")).toMatchObject([
    {
      id: "list-item",
      title: "Legacy anime",
      mediaKind: "anime",
      contentType: undefined,
    },
  ]);
  db.close();
});
