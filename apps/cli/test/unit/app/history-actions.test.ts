import { expect, test } from "bun:test";

import { markEntryWatched } from "@/app/history-actions";
import type { HistoryEntry } from "@/services/persistence/HistoryStore";

function entry(patch: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    title: "Demo",
    type: "series",
    season: 1,
    episode: 4,
    timestamp: 320,
    duration: 1400,
    completed: false,
    provider: "vidking",
    watchedAt: "2026-05-10T00:00:00.000Z",
    ...patch,
  };
}

test("markEntryWatched flags completed and snaps position to the end", () => {
  const marked = markEntryWatched(entry({ timestamp: 320, duration: 1400 }), () => "NOW");
  expect(marked.completed).toBe(true);
  expect(marked.timestamp).toBe(1400);
  expect(marked.watchedAt).toBe("NOW");
  // preserves identity fields
  expect(marked).toMatchObject({ title: "Demo", season: 1, episode: 4, provider: "vidking" });
});

test("markEntryWatched keeps the saved position when duration is unknown", () => {
  const marked = markEntryWatched(entry({ timestamp: 320, duration: 0 }), () => "NOW");
  expect(marked.completed).toBe(true);
  expect(marked.timestamp).toBe(320);
});
