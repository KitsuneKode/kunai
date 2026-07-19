import { expect, test } from "bun:test";

import { QueueService } from "@/domain/queue/QueueService";
import { restoreQueueSessionWithResume } from "@/domain/queue/restore-queue-session";
import {
  openKunaiDatabase,
  QueueRepository,
  runMigrations,
  type HistoryProgress,
} from "@kunai/storage";

function historyRow(
  overrides: Partial<HistoryProgress> & Pick<HistoryProgress, "titleId">,
): HistoryProgress {
  return {
    key: `${overrides.titleId}:1:1`,
    mediaKind: "series",
    title: "Example",
    season: 1,
    episode: 1,
    positionSeconds: 600,
    durationSeconds: 1400,
    completed: false,
    // Just inside the old session's window (it stopped at 01:00 on the 19th),
    // which is where a genuinely interrupted episode's checkpoint lands.
    updatedAt: "2026-07-19T00:59:00.000Z",
    createdAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  } as HistoryProgress;
}

function setup(): { repo: QueueRepository; service: QueueService; close: () => void } {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const repo = new QueueRepository(db);
  repo.createQueueSession({
    id: "old-session",
    status: "recoverable",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T01:00:00.000Z",
  });
  repo.createQueueSession({
    id: "current-session",
    status: "active",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  });
  return { repo, service: new QueueService(repo, "current-session"), close: () => db.close() };
}

test("restore prepends the in-progress episode so the queue resumes where playback stopped", () => {
  const { repo, service, close } = setup();
  repo.enqueue({
    title: "Queued Show",
    mediaKind: "series",
    titleId: "tmdb:99",
    season: 1,
    episode: 1,
    source: "watchlist",
    sessionId: "old-session",
  });

  const result = restoreQueueSessionWithResume(
    {
      queue: service,
      readHistory: () => [
        historyRow({ titleId: "tmdb:42", title: "Interrupted Show", season: 2, episode: 3 }),
      ],
    },
    "old-session",
  );

  expect(result.restoredCount).toBe(1);
  expect(result.resumeHead?.titleId).toBe("tmdb:42");
  // The partially-watched episode is the head, ahead of the restored item.
  expect(service.getUnplayed().map((entry) => entry.titleId)).toEqual(["tmdb:42", "tmdb:99"]);
  expect(service.peekNext()?.source).toBe("resume");
  close();
});

test("restore does not duplicate an in-progress episode already present in the queue", () => {
  const { repo, service, close } = setup();
  repo.enqueue({
    title: "Interrupted Show",
    mediaKind: "series",
    titleId: "tmdb:42",
    season: 2,
    episode: 3,
    source: "watchlist",
    sessionId: "old-session",
  });

  const result = restoreQueueSessionWithResume(
    {
      queue: service,
      readHistory: () => [
        historyRow({ titleId: "tmdb:42", title: "Interrupted Show", season: 2, episode: 3 }),
      ],
    },
    "old-session",
  );

  expect(result.resumeHead).toBeUndefined();
  expect(service.getUnplayed()).toHaveLength(1);
  close();
});

test("restore ignores finished and barely-started history rows", () => {
  const { repo, service, close } = setup();
  repo.enqueue({
    title: "Queued Show",
    mediaKind: "series",
    titleId: "tmdb:99",
    source: "watchlist",
    sessionId: "old-session",
  });

  const result = restoreQueueSessionWithResume(
    {
      queue: service,
      readHistory: () => [
        // Both inside the session window, so only the finished/short filters
        // can be what rejects them.
        historyRow({ titleId: "tmdb:1", completed: true, updatedAt: "2026-07-19T00:58:00.000Z" }),
        historyRow({
          titleId: "tmdb:2",
          positionSeconds: 4,
          updatedAt: "2026-07-19T00:57:00.000Z",
        }),
      ],
    },
    "old-session",
  );

  expect(result.resumeHead).toBeUndefined();
  expect(service.getUnplayed().map((entry) => entry.titleId)).toEqual(["tmdb:99"]);
  close();
});

test("restore ignores a title watched after the session ended", () => {
  const { repo, service, close } = setup();
  repo.enqueue({
    title: "Queued Show",
    mediaKind: "series",
    titleId: "tmdb:99",
    source: "watchlist",
    sessionId: "old-session",
  });

  const result = restoreQueueSessionWithResume(
    {
      queue: service,
      readHistory: () => [
        // Watched a day after the session was marked recoverable (01:00 on the
        // 19th) — belongs to a later session, not this queue.
        historyRow({
          titleId: "tmdb:unrelated",
          title: "Unrelated Movie",
          mediaKind: "movie",
          season: undefined,
          episode: undefined,
          updatedAt: "2026-07-20T12:00:00.000Z",
        }),
        historyRow({
          titleId: "tmdb:42",
          title: "Interrupted Show",
          season: 2,
          episode: 3,
          updatedAt: "2026-07-19T00:59:00.000Z",
        }),
      ],
    },
    "old-session",
  );

  expect(result.resumeHead?.titleId).toBe("tmdb:42");
  expect(service.peekNext()?.titleId).toBe("tmdb:42");
  close();
});

test("restore of an unrecoverable session changes nothing", () => {
  const { service, close } = setup();

  const result = restoreQueueSessionWithResume(
    {
      queue: service,
      readHistory: () => [historyRow({ titleId: "tmdb:42" })],
    },
    "does-not-exist",
  );

  expect(result.restoredCount).toBe(0);
  expect(result.resumeHead).toBeUndefined();
  expect(service.getUnplayed()).toHaveLength(0);
  close();
});
