import { describe, expect, test } from "bun:test";

import {
  HISTORY_KEEP_DAYS,
  type HistoryFile,
  updateHistory,
  utcDay,
} from "../scripts/provider-status-history";

const healthy = { vidlink: "healthy", hianime: "healthy" } as const;

describe("utcDay", () => {
  test("is the UTC calendar day of an ISO timestamp", () => {
    expect(utcDay("2026-10-02T23:59:59.000Z")).toBe("2026-10-02");
    expect(utcDay("2026-10-03T00:00:00.000Z")).toBe("2026-10-03");
  });
});

describe("updateHistory", () => {
  test("starts a record from nothing", () => {
    expect(updateHistory(null, "2026-10-01", healthy)).toEqual({
      schemaVersion: 1,
      days: [{ day: "2026-10-01", providers: healthy }],
    });
  });

  test("appends later days and keeps them oldest first", () => {
    const first = updateHistory(null, "2026-10-01", healthy);
    const second = updateHistory(first, "2026-10-02", { vidlink: "blocked" });
    expect(second.days.map((entry) => entry.day)).toEqual(["2026-10-01", "2026-10-02"]);
  });

  test("sorts a day that arrives out of order into place", () => {
    const base = updateHistory(updateHistory(null, "2026-10-03", healthy), "2026-10-01", healthy);
    expect(base.days.map((entry) => entry.day)).toEqual(["2026-10-01", "2026-10-03"]);
  });

  test("a second sweep on the same UTC day replaces the first instead of doubling the day", () => {
    const first = updateHistory(null, "2026-10-01", { vidlink: "dead" });
    const rerun = updateHistory(first, "2026-10-01", { vidlink: "healthy" });
    expect(rerun.days).toHaveLength(1);
    expect(rerun.days[0]?.providers.vidlink).toBe("healthy");
  });

  test("keeps only the newest days once it is over the limit", () => {
    let history: HistoryFile | null = null;
    for (let index = 1; index <= 5; index += 1) {
      history = updateHistory(history, `2026-10-0${index}`, healthy, 3);
    }
    expect(history?.days.map((entry) => entry.day)).toEqual([
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
  });

  test("the default keeps sixty days", () => {
    expect(HISTORY_KEEP_DAYS).toBe(60);
  });

  test("does not mutate the file it was given", () => {
    const previous = updateHistory(null, "2026-10-01", healthy);
    const snapshot = JSON.stringify(previous);
    updateHistory(previous, "2026-10-02", healthy);
    expect(JSON.stringify(previous)).toBe(snapshot);
  });
});
