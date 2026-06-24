import { expect, test } from "bun:test";

import { markEntryWatched } from "@/app/search/history-actions";
import type { HistoryProgress } from "@kunai/storage";

function entry(patch: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "k",
    titleId: "demo",
    title: "Demo",
    mediaKind: "series",
    season: 1,
    episode: 4,
    positionSeconds: 320,
    durationSeconds: 1400,
    completed: false,
    providerId: "vidking",
    updatedAt: "2026-05-10T00:00:00.000Z",
    createdAt: "2026-05-10T00:00:00.000Z",
    ...patch,
  };
}

test("markEntryWatched flags completed and snaps position to the end", () => {
  const marked = markEntryWatched(
    entry({ positionSeconds: 320, durationSeconds: 1400 }),
    () => "NOW",
  );
  expect(marked.completed).toBe(true);
  expect(marked.positionSeconds).toBe(1400);
  expect(marked.updatedAt).toBe("NOW");
  // preserves identity fields
  expect(marked).toMatchObject({ title: "Demo", season: 1, episode: 4, providerId: "vidking" });
});

test("markEntryWatched keeps the saved position when duration is unknown", () => {
  const marked = markEntryWatched(entry({ positionSeconds: 320, durationSeconds: 0 }), () => "NOW");
  expect(marked.completed).toBe(true);
  expect(marked.positionSeconds).toBe(320);
});
