import { expect, test } from "bun:test";

import type { Container } from "@/container";
import { markMediaItemWatched } from "@/services/media-actions/create-container-media-action-router";
import { HistoryRepository, openKunaiDatabase, runMigrations } from "@kunai/storage";

function makeContainer(): Container {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const historyRepository = new HistoryRepository(db);
  return {
    historyRepository,
    queueService: { enqueueMediaItem: () => {} },
    downloadService: { getEnqueueEligibility: () => ({ allowed: false }) },
    listService: { addToWatchlist: () => {} },
    followedTitleRepository: { upsert: () => {} },
    notificationService: { listActive: () => [] },
    stateManager: { dispatch: () => {} },
  } as unknown as Container;
}

const item = {
  mediaKind: "series" as const,
  titleId: "show-1",
  title: "Demo Show",
  season: 1,
  episode: 2,
};

test("markMediaItemWatched matches HistoryRepository.markWatched", () => {
  const container = makeContainer();
  const at = "2026-06-20T12:00:00.000Z";

  container.historyRepository.upsertProgress({
    title: { id: item.titleId, kind: "series", title: item.title },
    episode: { season: 1, episode: 2 },
    positionSeconds: 300,
    durationSeconds: 1_200,
    completed: false,
    watchedSeconds: 300,
  });

  markMediaItemWatched(container, item, true);
  const viaRouter = container.historyRepository.getProgress(
    { id: item.titleId, kind: "series", title: item.title },
    { season: 1, episode: 2 },
  );

  const direct = makeContainer();
  direct.historyRepository.upsertProgress({
    title: { id: item.titleId, kind: "series", title: item.title },
    episode: { season: 1, episode: 2 },
    positionSeconds: 300,
    durationSeconds: 1_200,
    completed: false,
    watchedSeconds: 300,
  });
  direct.historyRepository.markWatched(
    { id: item.titleId, kind: "series", title: item.title },
    { season: 1, episode: 2 },
    at,
  );
  const viaRepo = direct.historyRepository.getProgress(
    { id: item.titleId, kind: "series", title: item.title },
    { season: 1, episode: 2 },
  );

  expect(viaRouter?.completed).toBe(viaRepo?.completed);
  expect(viaRouter?.positionSeconds).toBe(viaRepo?.positionSeconds);
  expect(viaRouter?.watchedSeconds).toBe(viaRepo?.watchedSeconds);
});

test("markMediaItemWatched unwatched preserves resume fields", () => {
  const container = makeContainer();
  markMediaItemWatched(container, item, true);
  const watched = container.historyRepository.getProgress(
    { id: item.titleId, kind: "series", title: item.title },
    { season: 1, episode: 2 },
  );

  markMediaItemWatched(container, item, false);
  const unwatched = container.historyRepository.getProgress(
    { id: item.titleId, kind: "series", title: item.title },
    { season: 1, episode: 2 },
  );

  expect(unwatched?.completed).toBe(false);
  expect(unwatched?.positionSeconds).toBe(watched?.positionSeconds);
  expect(unwatched?.watchedSeconds).toBe(watched?.watchedSeconds);
});
