import { expect, test } from "bun:test";

import { QueueService } from "@/domain/queue/QueueService";
import { DurablePlaylistService } from "@/services/playlists/DurablePlaylistService";
import {
  openKunaiDatabase,
  PlaylistsRepository,
  QueueRepository,
  runMigrations,
} from "@kunai/storage";

test("DurablePlaylistService creates playlists and exports safe documents", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const service = new DurablePlaylistService(new PlaylistsRepository(db), {
    now: () => "2026-05-17T00:00:00.000Z",
    id: (prefix) => `${prefix}-1`,
  });

  const playlist = service.createPlaylist("Weekend");
  service.addItem(playlist.id, {
    titleId: "tmdb:1",
    mediaKind: "series",
    title: "Example",
    season: 1,
    episode: 2,
    providerHints: [{ providerId: "vidking", streamUrl: "https://must-not-leak.example" }],
  });

  const exported = service.exportPlaylist(playlist.id, "Weekend", []);

  expect(exported.items).toHaveLength(1);
  expect(JSON.stringify(exported)).not.toContain("http");

  db.close();
});

test("DurablePlaylistService loads playlist items into the runtime queue", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const queueRepo = new QueueRepository(db);
  queueRepo.createQueueSession({
    id: "session-1",
    status: "active",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
  });
  const queueService = new QueueService(queueRepo, "session-1");
  const service = new DurablePlaylistService(new PlaylistsRepository(db), {
    now: () => "2026-05-17T00:00:00.000Z",
    id: (() => {
      let counter = 0;
      return (prefix) => `${prefix}-load-${++counter}`;
    })(),
  });

  const playlist = service.createPlaylist("Weekend");
  service.addItem(playlist.id, {
    titleId: "tmdb:1",
    mediaKind: "series",
    title: "Example",
    season: 1,
    episode: 2,
  });
  service.addItem(playlist.id, {
    titleId: "tmdb:2",
    mediaKind: "movie",
    title: "Movie",
  });

  expect(service.loadIntoQueue(queueService, playlist.id)).toBe(2);
  expect(queueService.getAll().map((item) => item.source)).toEqual([
    "durable-playlist",
    "durable-playlist",
  ]);

  db.close();
});

test("DurablePlaylistService imports safe playlist documents without autoplay intent", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const service = new DurablePlaylistService(new PlaylistsRepository(db), {
    now: () => "2026-05-17T00:00:00.000Z",
    id: (prefix) => `${prefix}-imported`,
  });

  const playlist = service.importPlaylist({
    format: "kunai-playlist",
    version: 1,
    exportedAt: "2026-05-16T00:00:00.000Z",
    playlist: { name: "Weekend taste" },
    items: [
      {
        titleId: "tmdb:1",
        mediaKind: "series",
        title: "Example",
        season: 1,
        episode: 2,
        sortOrder: 0,
        providerHints: [{ providerId: "vidking" }],
        progressPercent: 75,
      },
    ],
  });

  expect(service.listPlaylists()[0]?.id).toBe(playlist.id);
  expect(service.listItems(playlist.id)).toMatchObject([
    {
      titleId: "tmdb:1",
      title: "Example",
      season: 1,
      episode: 2,
    },
  ]);

  db.close();
});

test("DurablePlaylistService renames and deletes durable playlists", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const service = new DurablePlaylistService(new PlaylistsRepository(db), {
    now: () => "2026-05-17T00:00:00.000Z",
    id: (prefix) => `${prefix}-1`,
  });

  const playlist = service.createPlaylist("Weekend");
  const renamed = service.renamePlaylist(playlist.id, "Road trip");
  expect(renamed.name).toBe("Road trip");

  service.addItem(playlist.id, {
    titleId: "tmdb:9",
    mediaKind: "movie",
    title: "Example",
  });
  const [item] = service.listItems(playlist.id);
  expect(item).toBeDefined();
  service.removeItem(item!.id);
  expect(service.listItems(playlist.id)).toHaveLength(0);

  service.deletePlaylist(playlist.id);
  expect(service.listPlaylists()).toHaveLength(0);

  db.close();
});
