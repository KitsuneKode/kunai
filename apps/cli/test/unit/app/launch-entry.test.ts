import { describe, expect, test } from "bun:test";

import {
  applyHistorySelectionProvider,
  episodeFromHistorySelection,
  selectContinueHistoryEntry,
  selectContinueHistoryEntryFromRecent,
  selectLocalContinueCandidate,
  titleFromHistorySelection,
} from "@/app/launch-entry";
import type { HistoryProgress } from "@kunai/storage";

function history(patch: Partial<HistoryProgress> = {}): HistoryProgress {
  return {
    key: "k",
    titleId: "demo",
    title: "Demo Show",
    mediaKind: "series",
    season: 1,
    episode: 2,
    positionSeconds: 600,
    durationSeconds: 1800,
    completed: false,
    providerId: "vidsrc",
    updatedAt: "2026-05-14T08:00:00.000Z",
    createdAt: "2026-05-14T08:00:00.000Z",
    ...patch,
  };
}

describe("launch entry helpers", () => {
  test("selectContinueHistoryEntry picks the newest unfinished local history target", () => {
    const selected = selectContinueHistoryEntry({
      "finished-newer": history({
        title: "Finished",
        completed: true,
        updatedAt: "2026-05-14T10:00:00.000Z",
      }),
      "unfinished-older": history({
        title: "Older",
        updatedAt: "2026-05-14T07:00:00.000Z",
      }),
      "unfinished-newer": history({
        title: "Newer",
        updatedAt: "2026-05-14T09:00:00.000Z",
      }),
    });

    expect(selected).toEqual({
      titleId: "unfinished-newer",
      entry: expect.objectContaining({ title: "Newer" }),
    });
  });

  test("selectContinueHistoryEntryFromRecent keeps older unfinished episodes reachable", () => {
    const selected = selectContinueHistoryEntryFromRecent([
      [
        "demo-show",
        history({
          title: "Demo Show",
          season: 1,
          episode: 6,
          positionSeconds: 1800,
          durationSeconds: 1800,
          completed: true,
          updatedAt: "2026-05-14T10:00:00.000Z",
        }),
      ],
      [
        "demo-show",
        history({
          title: "Demo Show",
          season: 1,
          episode: 7,
          positionSeconds: 600,
          durationSeconds: 1800,
          completed: false,
          updatedAt: "2026-05-14T09:00:00.000Z",
        }),
      ],
    ]);

    expect(selected).toEqual({
      titleId: "demo-show",
      entry: expect.objectContaining({ season: 1, episode: 7, completed: false }),
    });
  });

  test("titleFromHistorySelection rebuilds a playback title without provider work", () => {
    expect(
      titleFromHistorySelection({
        titleId: "tmdb:1399",
        entry: history({ title: "Game of Thrones", mediaKind: "series" }),
      }),
    ).toEqual({
      id: "tmdb:1399",
      type: "series",
      name: "Game of Thrones",
    });
  });

  test("episodeFromHistorySelection prefers explicit continuation targets", () => {
    expect(
      episodeFromHistorySelection({
        titleId: "anilist:123",
        entry: history({ season: 1, episode: 6 }),
        targetEpisode: { season: 1, episode: 7, reason: "new-episode" },
      }),
    ).toEqual({ season: 1, episode: 7 });
  });

  test("applyHistorySelectionProvider prefers saved title provider over history", () => {
    const transitions: unknown[] = [];

    applyHistorySelectionProvider(
      {
        config: {
          getRaw() {
            return {
              titleProviderPreferences: { "tmdb:123": "vidking" },
            };
          },
        },
        providerRegistry: {
          get(providerId: string) {
            return {
              metadata: {
                id: providerId,
                isAnimeProvider: providerId === "allanime",
              },
            };
          },
        },
        stateManager: {
          getState() {
            return { provider: "rivestream", providerSwitchSeq: 0 };
          },
          dispatch(transition: unknown) {
            transitions.push(transition);
          },
        },
      } as never,
      {
        titleId: "tmdb:123",
        entry: history({
          providerId: "rivestream",
          season: 1,
          episode: 5,
        }),
      },
    );

    expect(transitions).toContainEqual({
      type: "SET_MODE",
      mode: "series",
      provider: "vidking",
    });
    expect(transitions).not.toContainEqual({
      type: "SET_MODE",
      mode: "series",
      provider: "rivestream",
    });
  });

  test("applyHistorySelectionProvider restores the explicit target episode", () => {
    const transitions: unknown[] = [];

    applyHistorySelectionProvider(
      {
        config: {
          getRaw() {
            return { titleProviderPreferences: {} };
          },
        },
        providerRegistry: {
          get() {
            return {
              metadata: {
                id: "allanime",
                isAnimeProvider: true,
              },
            };
          },
        },
        stateManager: {
          getState() {
            return { provider: "allanime", providerSwitchSeq: 0 };
          },
          dispatch(transition: unknown) {
            transitions.push(transition);
          },
        },
      } as never,
      {
        titleId: "anilist:123",
        entry: history({
          providerId: "allanime",
          season: 1,
          episode: 6,
          completed: true,
        }),
        targetEpisode: { season: 1, episode: 7, reason: "new-episode" },
      },
    );

    expect(transitions).toContainEqual({
      type: "SET_MODE",
      mode: "anime",
      provider: "allanime",
    });
    expect(transitions).toContainEqual({
      type: "SELECT_EPISODE",
      episode: { season: 1, episode: 7 },
    });
  });

  test("selectLocalContinueCandidate only picks an exact ready local episode", () => {
    const selection = {
      titleId: "solo",
      entry: history({ title: "Solo Leveling", season: 1, episode: 4 }),
    };

    const picked = selectLocalContinueCandidate(selection, [
      {
        status: "ready",
        job: {
          id: "wrong-episode",
          titleId: "solo",
          titleName: "Solo Leveling",
          mediaKind: "series",
          providerId: "allanime",
          streamUrl: "https://example/wrong.m3u8",
          headers: {},
          status: "completed",
          progressPercent: 100,
          outputPath: "/downloads/solo-s01e03.mp4",
          tempPath: "/downloads/solo.tmp",
          retryCount: 0,
          attempt: 1,
          maxAttempts: 3,
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
          season: 1,
          episode: 3,
        },
      },
      {
        status: "missing",
        job: {
          id: "broken",
          titleId: "solo",
          titleName: "Solo Leveling",
          mediaKind: "series",
          providerId: "allanime",
          streamUrl: "https://example/broken.m3u8",
          headers: {},
          status: "completed",
          progressPercent: 100,
          outputPath: "/downloads/solo-s01e04.mp4",
          tempPath: "/downloads/solo.tmp",
          retryCount: 0,
          attempt: 1,
          maxAttempts: 3,
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
          season: 1,
          episode: 4,
        },
      },
      {
        status: "ready",
        job: {
          id: "ready",
          titleId: "solo",
          titleName: "Solo Leveling",
          mediaKind: "series",
          providerId: "allanime",
          streamUrl: "https://example/ready.m3u8",
          headers: {},
          status: "completed",
          progressPercent: 100,
          outputPath: "/downloads/solo-s01e04-ready.mp4",
          tempPath: "/downloads/solo.tmp",
          retryCount: 0,
          attempt: 1,
          maxAttempts: 3,
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
          season: 1,
          episode: 4,
        },
      },
    ]);

    expect(picked?.job.id).toBe("ready");
  });
});
