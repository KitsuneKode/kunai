import { expect, test } from "bun:test";

import { queuePlaybackIntentFromEntry } from "@/domain/queue/queue-playback-intent";
import type { QueueEntry } from "@kunai/storage";

const ANIME_ENTRY: QueueEntry = {
  id: "queue-17",
  title: "Attack on Titan",
  mediaKind: "anime",
  titleId: "anilist:16498",
  absoluteEpisode: 13,
  priority: 0,
  source: "manual",
  addedAt: "2026-07-20T10:00:00.000Z",
  sessionId: "session",
  status: "pending",
};

test("intent carries absolute anime episode", () => {
  expect(queuePlaybackIntentFromEntry(ANIME_ENTRY, "queue")).toMatchObject({
    queueEntryId: "queue-17",
    titleId: "anilist:16498",
    absoluteEpisode: 13,
  });
});

test("intent preserves season/episode and source", () => {
  const seriesEntry: QueueEntry = {
    ...ANIME_ENTRY,
    id: "queue-9",
    mediaKind: "series",
    titleId: "tmdb:1396",
    season: 2,
    episode: 4,
    absoluteEpisode: undefined,
  };
  expect(queuePlaybackIntentFromEntry(seriesEntry, "auto-next")).toEqual({
    queueEntryId: "queue-9",
    titleId: "tmdb:1396",
    mediaKind: "series",
    season: 2,
    episode: 4,
    absoluteEpisode: undefined,
    source: "auto-next",
  });
});
