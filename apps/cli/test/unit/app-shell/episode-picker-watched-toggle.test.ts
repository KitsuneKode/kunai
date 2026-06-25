import { expect, test } from "bun:test";

import { isFinished } from "@/services/continuation/history-progress";
import type { HistoryProgress } from "@kunai/storage";

function episodePickerAlreadyWatched(progress: HistoryProgress | undefined): boolean {
  return progress ? isFinished(progress) : false;
}

function row(partial: Partial<HistoryProgress>): HistoryProgress {
  return {
    key: "k",
    titleId: "t1",
    mediaKind: "series",
    title: "Demo",
    positionSeconds: 0,
    completed: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

test("episode picker treats 96% without completed flag as watched for m toggle", () => {
  const progress = row({
    completed: false,
    positionSeconds: 1_152,
    durationSeconds: 1_200,
  });
  expect(episodePickerAlreadyWatched(progress)).toBe(true);
});

test("episode picker treats partial progress as unwatched for m toggle", () => {
  const progress = row({
    completed: false,
    positionSeconds: 400,
    durationSeconds: 1_200,
  });
  expect(episodePickerAlreadyWatched(progress)).toBe(false);
});
