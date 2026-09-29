import { afterEach, expect, spyOn, test } from "bun:test";

import { PlaylistsRepository, type UserPlaylistItemRecord } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();
afterEach(() => stores.cleanup());

function createRepository() {
  const db = stores.store("playlists-batch");
  const repo = new PlaylistsRepository(db);
  repo.create({
    id: "playlist-1",
    name: "Mixed playlist",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
  return repo;
}

function item(index: number): UserPlaylistItemRecord {
  const anime = index % 2 === 0;
  return {
    id: `item-${index}`,
    playlistId: "playlist-1",
    titleId: `${anime ? "anilist" : "tmdb"}:${index}`,
    mediaKind: anime ? "anime" : "movie",
    contentType: anime ? "series" : "movie",
    externalIds: anime ? { anilistId: String(index) } : { tmdbId: String(index) },
    title: `Title ${index} 日本語`,
    season: anime ? 1 : undefined,
    episode: anime ? index + 1 : undefined,
    absoluteEpisode: anime ? index + 10 : undefined,
    sortOrder: index,
    providerHintsJson: JSON.stringify([
      { providerId: anime ? "allmanga" : "vidking", sourceId: `source-${index}` },
    ]),
    notes: index % 3 === 0 ? `Note ${index}` : undefined,
    addedAt: `2026-09-01T00:00:${String(index).padStart(2, "0")}.000Z`,
  };
}

test("playlist batch returns stored payloads without reading the playlist", () => {
  const repo = createRepository();
  const rows = Array.from({ length: 50 }, (_, index) => item(index));
  const reads = spyOn(repo, "listItems");
  try {
    const added = repo.addItems(rows);
    expect(reads).toHaveBeenCalledTimes(0);
    expect(added).toEqual(rows);
    expect(repo.listItems("playlist-1")).toEqual(added);
    expect(added[0]!.externalIds).not.toBe(rows[0]!.externalIds);
  } finally {
    reads.mockRestore();
  }
});

test("single playlist inserts preserve normalization, optional fields, and supplied ordering", () => {
  const repo = createRepository();
  const first = repo.addItem(item(2));
  const second = repo.addItem({
    ...item(1),
    externalIds: {},
    providerHintsJson: "not-json",
    notes: "",
    season: 0,
  });
  expect(first).toEqual(item(2));
  expect(second).toEqual({
    ...item(1),
    externalIds: undefined,
    providerHintsJson: "not-json",
    notes: "",
    season: 0,
  });
  expect(repo.listItems("playlist-1")).toEqual([second, first]);
  expect(() => repo.addItem(item(2))).toThrow();
  expect(repo.listItems("playlist-1")).toEqual([second, first]);
});

test("playlist batch rolls back earlier inserts on a duplicate id and accepts an empty batch", () => {
  const repo = createRepository();
  const existing = repo.addItem(item(0));
  expect(() => repo.addItems([item(1), item(0)])).toThrow();
  expect(repo.listItems("playlist-1")).toEqual([existing]);
  expect(repo.addItems([])).toEqual([]);
});
