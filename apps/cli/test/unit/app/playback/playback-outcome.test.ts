import { describe, expect, test } from "bun:test";

import {
  playlistAdvanceFromQueueIntent,
  resolvePlaylistAutoNextCountdown,
} from "@/app/playback/playback-outcome";
import type { QueuePlaybackIntent } from "@/domain/queue/queue-playback-intent";
import { QueueService } from "@/domain/queue/QueueService";
import { openKunaiDatabase, QueueRepository, runMigrations } from "@kunai/storage";

const ABS_ONLY_INTENT: QueuePlaybackIntent = {
  queueEntryId: "qe-abs-13",
  titleId: "anilist:42",
  mediaKind: "anime",
  absoluteEpisode: 13,
  source: "auto-next",
};

describe("playlistAdvanceFromQueueIntent", () => {
  test("abs-only anime intent yields S1E{abs} for SessionController SELECT_EPISODE", () => {
    const outcome = playlistAdvanceFromQueueIntent({
      intent: ABS_ONLY_INTENT,
      title: "Abs Anime",
    });

    expect(outcome).toEqual({
      type: "playlist-advance",
      titleInfo: {
        id: "anilist:42",
        name: "Abs Anime",
        type: "series",
        queuePlaybackIntent: ABS_ONLY_INTENT,
      },
      mode: "anime",
      season: 1,
      episode: 13,
    });
    expect(outcome.titleInfo.queuePlaybackIntent?.absoluteEpisode).toBe(13);
    expect(outcome.titleInfo.queuePlaybackIntent?.episode).toBeUndefined();
    expect(outcome.titleInfo.queuePlaybackIntent?.season).toBeUndefined();
  });

  test("explicit season/episode overrides win over absoluteEpisode", () => {
    const intent: QueuePlaybackIntent = {
      ...ABS_ONLY_INTENT,
      season: 2,
      episode: 4,
      absoluteEpisode: 28,
    };
    const outcome = playlistAdvanceFromQueueIntent({
      intent,
      title: "Seasoned",
      season: 2,
      episode: 4,
    });
    expect(outcome.season).toBe(2);
    expect(outcome.episode).toBe(4);
  });
});

describe("resolvePlaylistAutoNextCountdown", () => {
  test("cancel rolls back the exact claimed intent; advance carries abs identity", () => {
    const db = openKunaiDatabase(":memory:");
    runMigrations(db, "data");
    const repo = new QueueRepository(db);
    repo.createQueueSession({
      id: "s",
      status: "active",
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
    });
    const head = repo.enqueue({
      title: "Head",
      mediaKind: "anime",
      titleId: "anilist:1",
      absoluteEpisode: 1,
      source: "manual",
      sessionId: "s",
    });
    const selected = repo.enqueue({
      title: "Abs Anime",
      mediaKind: "anime",
      titleId: "anilist:42",
      absoluteEpisode: 13,
      source: "manual",
      sessionId: "s",
    });
    const queue = new QueueService(repo, "s");

    // Claim exact ID before countdown (not head).
    const claimed = queue.beginPlayback(selected.id, "auto-next", "2026-07-21T01:00:00.000Z");
    expect(claimed?.queueEntryId).toBe(selected.id);
    expect(claimed?.absoluteEpisode).toBe(13);
    expect(repo.getById(head.id)?.status).toBe("pending");
    expect(repo.getById(selected.id)?.status).toBe("in-flight");

    const cancelled = resolvePlaylistAutoNextCountdown({
      intent: claimed!,
      title: selected.title,
      season: selected.season,
      episode: selected.episode,
      countdown: "cancelled",
      at: "2026-07-21T01:00:03.000Z",
    });
    expect(cancelled.kind).toBe("rollback");
    if (cancelled.kind !== "rollback") throw new Error("expected rollback");
    expect(cancelled.intent.queueEntryId).toBe(selected.id);
    expect(cancelled.failure).toEqual({
      code: "playback-aborted",
      stage: "handoff",
      at: "2026-07-21T01:00:03.000Z",
      detail: "auto-next countdown cancelled",
    });
    expect(queue.rollbackBeforeStart(cancelled.intent, cancelled.failure)).toBe(true);
    expect(repo.getById(selected.id)?.status).toBe("pending");

    // Re-claim and advance: handoff carries abs-only identity on the outcome.
    const reclaimed = queue.beginPlayback(selected.id, "auto-next", "2026-07-21T01:01:00.000Z");
    const advanced = resolvePlaylistAutoNextCountdown({
      intent: reclaimed!,
      title: selected.title,
      season: selected.season,
      episode: selected.episode,
      countdown: "advanced",
    });
    expect(advanced.kind).toBe("advance");
    if (advanced.kind !== "advance") throw new Error("expected advance");
    expect(advanced.outcome.season).toBe(1);
    expect(advanced.outcome.episode).toBe(13);
    expect(advanced.outcome.titleInfo.queuePlaybackIntent).toEqual(reclaimed);
    expect(advanced.outcome.titleInfo.queuePlaybackIntent?.absoluteEpisode).toBe(13);
    expect(advanced.outcome.titleInfo.queuePlaybackIntent?.queueEntryId).toBe(selected.id);

    db.close();
  });
});
