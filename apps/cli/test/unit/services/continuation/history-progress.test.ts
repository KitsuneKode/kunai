import { expect, test } from "bun:test";

import {
  formatTimestamp,
  historyContentType,
  isFinished,
} from "@/services/continuation/history-progress";
import type { HistoryProgress } from "@kunai/storage";

function row(overrides: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "k",
    titleId: "tmdb:1",
    mediaKind: "series",
    title: "Example",
    season: 1,
    episode: 1,
    positionSeconds: 0,
    durationSeconds: 1000,
    completed: false,
    updatedAt: "2026-05-01T00:00:00.000Z",
    createdAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

test("isFinished trusts the completed flag even when duration is unknown", () => {
  expect(isFinished(row({ completed: true, durationSeconds: 0, positionSeconds: 5 }))).toBe(true);
  expect(isFinished(row({ completed: true, durationSeconds: undefined }))).toBe(true);
});

test("isFinished with duration 0 and no completed flag is not finished", () => {
  expect(isFinished(row({ completed: false, durationSeconds: 0, positionSeconds: 9999 }))).toBe(
    false,
  );
  expect(isFinished(row({ completed: false, durationSeconds: undefined }))).toBe(false);
});

test("isFinished falls back to the 95% ratio only when duration is positive", () => {
  expect(isFinished(row({ completed: false, durationSeconds: 1000, positionSeconds: 960 }))).toBe(
    true,
  );
  expect(isFinished(row({ completed: false, durationSeconds: 1000, positionSeconds: 500 }))).toBe(
    false,
  );
});

test("formatTimestamp renders mm:ss and h:mm:ss", () => {
  expect(formatTimestamp(75)).toBe("1:15");
  expect(formatTimestamp(3725)).toBe("1:02:05");
});

test("historyContentType collapses anime to series, preserving the facade flatten", () => {
  // Consumers that previously read HistoryEntry.type relied on the facade
  // flattening anime -> "series". Preserve that exact mapping so anime rows keep
  // matching movie/series branches after the facade is retired.
  expect(historyContentType(row({ mediaKind: "movie" }))).toBe("movie");
  expect(historyContentType(row({ mediaKind: "series" }))).toBe("series");
  expect(historyContentType(row({ mediaKind: "anime" }))).toBe("series");
});
