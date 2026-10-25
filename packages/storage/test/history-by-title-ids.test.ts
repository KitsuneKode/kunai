import { afterEach, expect, test } from "bun:test";

import { HistoryRepository } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterEach(() => {
  stores.cleanup();
});

function repo(): HistoryRepository {
  const db = stores.store("history-by-title-ids", "data");
  return new HistoryRepository(db);
}

function seedTitle(r: HistoryRepository, id: string, episodes: number): void {
  for (let episode = 1; episode <= episodes; episode += 1) {
    r.upsertProgress({
      title: { id, kind: "series", title: `Title ${id}` },
      episode: { season: 1, episode },
      positionSeconds: 10,
      durationSeconds: 100,
      completed: false,
    });
  }
}

test("listByTitleIds returns only the requested titles, recency-ordered", () => {
  const r = repo();
  seedTitle(r, "title-a", 2);
  seedTitle(r, "title-b", 1);
  seedTitle(r, "title-c", 3);

  const rows = r.listByTitleIds(["title-c", "title-a"]);
  expect(rows.length).toBe(5);
  expect(new Set(rows.map((row) => row.titleId))).toEqual(new Set(["title-a", "title-c"]));
  // Recency-ordered like listRecent: updated_at never increases down the list.
  const times = rows.map((row) => Date.parse(row.updatedAt));
  for (let i = 1; i < times.length; i += 1) {
    // SAFETY: index bounds are guarded by the loop range over a fixed array.
    expect(times[i] as number).toBeLessThanOrEqual(times[i - 1] as number);
  }
});

test("listByTitleIds with no titles scans nothing and returns empty", () => {
  const r = repo();
  seedTitle(r, "title-a", 1);
  expect(r.listByTitleIds([])).toEqual([]);
  expect(r.listByTitleIds(["missing"])).toEqual([]);
});
