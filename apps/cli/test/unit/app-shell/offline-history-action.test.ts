import { expect, test } from "bun:test";

import { playCompletedDownload } from "@/app-shell/workflows";
import type { Container } from "@/container";

test("playCompletedDownload keeps an explicit history local action provider-free and replenishes runway after persistence", async () => {
  let played = 0;
  let stored = 0;
  let runwayTitleId: string | undefined;
  const source = {
    titleId: "tmdb:1",
    titleName: "Weekly Show",
    mediaKind: "series" as const,
    season: 1,
    episode: 6,
    providerId: "vidking",
    videoPath: "/downloads/weekly-show.mp4",
  };
  const container = {
    offlineLibraryService: {
      getPlayableSource: async () => ({ status: "ready", source }),
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
    player: {
      playLocal: async () => {
        played += 1;
        return { watchedSeconds: 600, duration: 1200, endedBy: "quit" };
      },
    },
    offlineRunwayService: {
      enqueueEvaluation: (titleId: string) => {
        runwayTitleId = titleId;
      },
    },
  } as unknown as Container;

  await playCompletedDownload(container, "job-6");

  expect(played).toBe(1);
  expect(stored).toBe(1);
  expect(runwayTitleId).toBe("tmdb:1");
});
