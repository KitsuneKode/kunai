import { expect, test } from "bun:test";

import { playCompletedDownload } from "@/app-shell/workflows";
import type { Container } from "@/container";

test("playCompletedDownload keeps an explicit history local action provider-free and replenishes runway after persistence", async () => {
  let played = 0;
  let stored = 0;
  let runwayTitleId: string | undefined;
  let resumePromptAt: number | undefined;
  const source = {
    titleId: "tmdb:1",
    titleName: "Weekly Show",
    mediaKind: "series" as const,
    season: 1,
    episode: 6,
    providerId: "vidking",
    videoPath: "/downloads/weekly-show.mp4",
  };
  const job = {
    id: "job-6",
    titleId: source.titleId,
    titleName: source.titleName,
    mediaKind: source.mediaKind,
    season: source.season,
    episode: source.episode,
    status: "ready",
    providerId: source.providerId,
    videoPath: source.videoPath,
  };
  const container = {
    offlineLibraryService: {
      getPlayableSource: async () => ({ status: "ready", source, job }),
      savePlaybackHistory: async () => {
        stored += 1;
        return true;
      },
    },
    stateManager: {
      getState: () => ({ autoskipSessionPaused: false }),
      dispatch: () => {},
    },
    config: {
      skipRecap: true,
      skipIntro: true,
      skipPreview: false,
      skipCredits: false,
    },
    diagnosticsService: { record: () => {} },
    historyRepository: {
      listByTitle: () => [
        {
          titleId: "tmdb:1",
          title: "Weekly Show",
          mediaKind: "series",
          season: 1,
          episode: 6,
          positionSeconds: 300,
          durationSeconds: 1200,
          updatedAt: new Date().toISOString(),
        },
      ],
    },
    player: {
      play: async (_stream: unknown, options: { resumePromptAt?: number }) => {
        played += 1;
        resumePromptAt = options.resumePromptAt;
        return { watchedSeconds: 600, duration: 1200, endReason: "quit", endedBy: "quit" };
      },
      releasePersistentSession: async () => {},
    },
    offlineRunwayService: {
      enqueueEvaluation: (titleId: string) => {
        runwayTitleId = titleId;
      },
    },
  } as unknown as Container;

  await playCompletedDownload(container, "job-6");

  expect(played).toBe(1);
  expect(resumePromptAt).toBe(300);
  expect(stored).toBe(1);
  expect(runwayTitleId).toBe("tmdb:1");
});
