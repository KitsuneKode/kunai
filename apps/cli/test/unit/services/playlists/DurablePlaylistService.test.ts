import { expect, spyOn, test } from "bun:test";

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

test("DurablePlaylistService round-trips anime movie structure into the runtime queue", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const queueRepo = new QueueRepository(db);
  queueRepo.createQueueSession({
    id: "session-film",
    status: "active",
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
  });
  const service = new DurablePlaylistService(new PlaylistsRepository(db), {
    now: () => "2026-08-16T00:00:00.000Z",
    id: (prefix) => `${prefix}-film`,
  });
  const playlist = service.createPlaylist("Anime films");
  service.addItem(playlist.id, {
    titleId: "anilist:181053",
    mediaKind: "anime",
    contentType: "movie",
    title: "Infinity Castle",
    externalIds: { anilistId: "181053" },
  });

  expect(service.listItems(playlist.id)).toMatchObject([
    { contentType: "movie", externalIds: { anilistId: "181053" } },
  ]);
  const exported = service.exportPlaylist(playlist.id, "Anime films", []);
  expect(exported.items).toMatchObject([
    { contentType: "movie", externalIds: { anilistId: "181053" } },
  ]);

  const queue = new QueueService(queueRepo, "session-film");
  expect(service.loadIntoQueue(queue, playlist.id)).toBe(1);
  expect(queue.getAll()).toMatchObject([
    {
      mediaKind: "anime",
      contentType: "movie",
      externalIds: { anilistId: "181053" },
    },
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
        contentType: "series",
        externalIds: { anilistId: "999999", tmdbId: "1" },
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
      titleId: "imported-unresolved:tmdb:1",
      title: "Example",
      season: 1,
      episode: 2,
    },
  ]);
  expect(service.listItems(playlist.id)[0]?.externalIds).toBeUndefined();

  db.close();
});

test("DurablePlaylistService imports large playlists in one bounded batch", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new PlaylistsRepository(db);
  const service = new DurablePlaylistService(repo, {
    now: () => "2026-09-01T00:00:00.000Z",
    id: (() => {
      let counter = 0;
      return (prefix) => `${prefix}-import-${++counter}`;
    })(),
  });

  const reads = spyOn(repo, "listItems");
  const batches = spyOn(repo, "addItems");
  try {
    const playlist = service.importPlaylist({
      format: "kunai-playlist",
      version: 1,
      exportedAt: "2026-08-31T00:00:00.000Z",
      playlist: { name: "Big weekend" },
      items: Array.from({ length: 50 }, (_, index) => ({
        titleId: `${index % 2 === 0 ? "anilist" : "tmdb"}:${index + 1}`,
        mediaKind: index % 2 === 0 ? "anime" : "movie",
        contentType: index % 2 === 0 ? ("series" as const) : ("movie" as const),
        externalIds:
          index % 2 === 0 ? { anilistId: String(index + 1) } : { tmdbId: String(index + 1) },
        title: `Imported ${index} 日本語`,
        season: index % 2 === 0 ? 2 : undefined,
        episode: index % 2 === 0 ? index + 1 : undefined,
        sortOrder: index * 2,
        providerHints: [{ providerId: "vidking", sourceId: `source-${index}` }],
        progressPercent: 10 * index,
      })).reverse(),
    });

    expect(playlist.name).toBe("Big weekend");
    expect(playlist.description).toBe("Imported Kunai playlist");

    expect(reads).toHaveBeenCalledTimes(0);
    expect(batches).toHaveBeenCalledTimes(1);

    const stored = service.listItems(playlist.id);
    expect(stored).toHaveLength(50);
    expect(stored.map((item) => item.id)).toEqual(
      Array.from({ length: 50 }, (_, index) => `playlist-item-import-${index + 2}`),
    );
    expect(stored.map((item) => item.sortOrder)).toEqual(
      Array.from({ length: 50 }, (_, index) => index),
    );
    expect(stored).toMatchObject(
      Array.from({ length: 50 }, (_, index) => ({
        titleId: `imported-unresolved:${index % 2 === 0 ? "anilist" : "tmdb"}:${index + 1}`,
        title: `Imported ${index} 日本語`,
        season: index % 2 === 0 ? 2 : undefined,
        episode: index % 2 === 0 ? index + 1 : undefined,
        contentType: index % 2 === 0 ? "series" : "movie",
        externalIds: undefined,
        notes: undefined,
      })),
    );
    expect(stored.map((item) => JSON.parse(item.providerHintsJson ?? "[]"))).toEqual(
      Array.from({ length: 50 }, (_, index) => [
        { providerId: "vidking", sourceId: `source-${index}` },
      ]),
    );
    expect(stored.every((item) => item.addedAt === "2026-09-01T00:00:00.000Z")).toBe(true);
    expect(playlist).toEqual({
      id: "playlist-import-1",
      name: "Big weekend",
      description: "Imported Kunai playlist",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
  } finally {
    reads.mockRestore();
    batches.mockRestore();
    db.close();
  }
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
