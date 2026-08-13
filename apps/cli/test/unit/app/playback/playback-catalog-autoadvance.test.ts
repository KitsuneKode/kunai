import { describe, expect, test } from "bun:test";

import { planCatalogAutoAdvance } from "@/app/playback/playback-catalog-autoadvance";
import { createPlaybackSessionState } from "@/app/playback/playback-session-controller";
import type { EpisodeAvailability } from "@/domain/playback/playback-policy";
import { planMediaQueuePlacement } from "@/domain/queue/QueuePlanner";
import type { PlaybackResult } from "@/domain/types";
import type { QueueEntry } from "@kunai/storage";

const result: PlaybackResult = {
  endReason: "eof",
  watchedSeconds: 1_400,
  duration: 1_400,
  lastNonZeroPositionSeconds: 1_400,
  lastNonZeroDurationSeconds: 1_400,
  playerExitCode: 0,
  playerExitSignal: null,
};
const availability: EpisodeAvailability = {
  nextEpisode: { season: 1, episode: 2 },
  previousEpisode: null,
  nextSeasonEpisode: null,
  upcomingNext: null,
  animeNextReleaseUnknown: false,
  tmdbUnavailable: false,
};

function queueHead(priority: number): QueueEntry {
  return {
    id: "queue-next",
    title: "Interrupting title",
    titleId: "tmdb:99",
    mediaKind: "series",
    priority,
  } as QueueEntry;
}

async function plan(head: QueueEntry) {
  return await planCatalogAutoAdvance({
    autoplayAdvanceArgs: {
      result,
      title: { id: "tmdb:1", name: "Current", type: "series" },
      currentEpisode: { season: 1, episode: 1 },
      session: createPlaybackSessionState({ autoNextEnabled: true }),
      availability,
    },
    guards: {
      endReason: "eof",
      autoplayPaused: false,
      autoplaySessionPaused: false,
      signalAborted: false,
    },
    queueHead: head,
    seriesDone: false,
    autoplayRecommendations: false,
    isAnime: false,
  });
}

describe("catalog auto-advance queue precedence", () => {
  test("an explicit play-next head prevents the catalog episode countdown", async () => {
    const head = queueHead(planMediaQueuePlacement("next").priority);

    const planned = await plan(head);

    expect(planned.nextEpisode).toEqual({ season: 1, episode: 2 });
    expect(planned.catalogAutoNext).toEqual({ kind: "queue", entry: head });
  });

  test("an ordinary queue head stays behind the catalog episode chain", async () => {
    const head = queueHead(planMediaQueuePlacement("end").priority);

    const planned = await plan(head);

    expect(planned.catalogAutoNext).toEqual({
      kind: "episode",
      episode: { season: 1, episode: 2 },
    });
  });
});
