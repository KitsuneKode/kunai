import { describe, expect, test } from "bun:test";

import { mergeHistoryWatchState } from "@/domain/continuation/merge-history-progress";
import type { HistoryProgress } from "@kunai/storage";

function row(patch: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "k",
    titleId: "20431",
    mediaKind: "anime",
    title: "Hozuki",
    season: 1,
    episode: 1,
    positionSeconds: 0,
    completed: false,
    updatedAt: "2026-06-03T00:00:00.000Z",
    createdAt: "2026-06-03T00:00:00.000Z",
    ...patch,
  };
}

describe("mergeHistoryWatchState", () => {
  test("keeps the furthest position when the surviving row is behind", () => {
    // The regression: the survivor is chosen by `updated_at`, so a row opened a
    // minute ago at 10s beat yesterday's 100s and the resume point moved back.
    const survivor = row({ positionSeconds: 10, updatedAt: "2026-06-04T00:00:00.000Z" });
    const dropped = row({ positionSeconds: 100, updatedAt: "2026-06-03T00:00:00.000Z" });

    expect(mergeHistoryWatchState(survivor, dropped).positionSeconds).toBe(100);
  });

  test("does not move a position backwards when the survivor is ahead", () => {
    const survivor = row({ positionSeconds: 100 });
    const dropped = row({ positionSeconds: 10 });

    expect(mergeHistoryWatchState(survivor, dropped).positionSeconds).toBe(100);
  });

  test("completion is sticky in both directions", () => {
    expect(
      mergeHistoryWatchState(row({ completed: false }), row({ completed: true })).completed,
    ).toBe(true);
    expect(
      mergeHistoryWatchState(row({ completed: true }), row({ completed: false })).completed,
    ).toBe(true);
  });

  test("a completed merge clears the resume offset", () => {
    // A finished episode should offer a replay from the start, not a seek to
    // wherever the credits happened to be.
    const merged = mergeHistoryWatchState(
      row({ positionSeconds: 10 }),
      row({ positionSeconds: 1_400, completed: true }),
    );

    expect(merged.completed).toBe(true);
    expect(merged.positionSeconds).toBe(0);
  });

  test("completedAt follows the row that finished, earliest first", () => {
    const merged = mergeHistoryWatchState(
      row({ completed: false, completedAt: "2030-01-01T00:00:00.000Z" }),
      row({ completed: true, completedAt: "2026-06-01T00:00:00.000Z" }),
    );

    // The survivor's stamp is ignored because the survivor did not complete.
    expect(merged.completedAt).toBe("2026-06-01T00:00:00.000Z");
  });

  test("watchedSeconds is a maximum, never a sum", () => {
    // Both rows describe the same viewing; adding them would invent time.
    const merged = mergeHistoryWatchState(
      row({ watchedSeconds: 400 }),
      row({ watchedSeconds: 900 }),
    );

    expect(merged.watchedSeconds).toBe(900);
  });

  test("a real duration beats a missing one, and the longer of two wins", () => {
    expect(
      mergeHistoryWatchState(row({ durationSeconds: undefined }), row({ durationSeconds: 1_440 }))
        .durationSeconds,
    ).toBe(1_440);
    expect(
      mergeHistoryWatchState(row({ durationSeconds: 600 }), row({ durationSeconds: 1_440 }))
        .durationSeconds,
    ).toBe(1_440);
  });

  test("a zero or non-finite duration is not treated as real", () => {
    expect(
      mergeHistoryWatchState(row({ durationSeconds: 0 }), row({ durationSeconds: 1_440 }))
        .durationSeconds,
    ).toBe(1_440);
    expect(
      mergeHistoryWatchState(row({ durationSeconds: 0 }), row({ durationSeconds: undefined }))
        .durationSeconds,
    ).toBeUndefined();
  });

  test("createdAt reaches back to the earlier row", () => {
    const merged = mergeHistoryWatchState(
      row({ createdAt: "2026-06-03T00:00:00.000Z" }),
      row({ createdAt: "2025-01-01T00:00:00.000Z" }),
    );

    expect(merged.createdAt).toBe("2025-01-01T00:00:00.000Z");
  });

  test("lastWatchedAt takes the later stamp and tolerates nulls", () => {
    expect(
      mergeHistoryWatchState(
        row({ lastWatchedAt: null }),
        row({ lastWatchedAt: "2026-06-02T00:00:00.000Z" }),
      ).lastWatchedAt,
    ).toBe("2026-06-02T00:00:00.000Z");
    expect(
      mergeHistoryWatchState(row({ lastWatchedAt: null }), row({ lastWatchedAt: null }))
        .lastWatchedAt,
    ).toBeNull();
  });

  test("a corrupt timestamp does not poison the merge", () => {
    const merged = mergeHistoryWatchState(
      row({ createdAt: "not-a-date", lastWatchedAt: "also-not-a-date" }),
      row({ createdAt: "2026-06-01T00:00:00.000Z" }),
    );

    expect(merged.createdAt).toBe("2026-06-01T00:00:00.000Z");
    expect(merged.lastWatchedAt).toBeNull();
  });
});
