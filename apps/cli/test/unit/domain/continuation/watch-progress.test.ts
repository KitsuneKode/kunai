import { describe, expect, test } from "bun:test";

import { projectWatchProgress } from "@/domain/continuation/watch-progress";

describe("watch progress projection", () => {
  test("clamps in-progress percentages to user-facing resume range", () => {
    expect(projectWatchProgress({ timestamp: 1, duration: 1_000 })).toMatchObject({
      percentage: 1,
      completed: false,
      inProgress: false,
    });
    expect(projectWatchProgress({ timestamp: 600, duration: 1_200 })).toMatchObject({
      percentage: 50,
      completed: false,
      inProgress: true,
    });
  });

  test("turns near-end or explicit completion into one completed projection", () => {
    expect(projectWatchProgress({ timestamp: 1_190, duration: 1_200 })).toMatchObject({
      percentage: 100,
      completed: true,
      inProgress: false,
    });
    expect(projectWatchProgress({ timestamp: 20, duration: 1_200, completed: true })).toMatchObject(
      {
        percentage: 100,
        completed: true,
        inProgress: false,
      },
    );
  });

  test("handles missing duration without inventing percentages", () => {
    expect(projectWatchProgress({ timestamp: 600 })).toEqual({
      percentage: null,
      completed: false,
      inProgress: true,
    });
  });
});
