import { describe, expect, test } from "bun:test";

import {
  enqueueCurrentPlaybackDownload,
  runShellWorkflowFromOverlay,
} from "@/app-shell/workflows/shell-workflows";
import type { Container } from "@/container";
import type { DownloadJobRecord } from "@kunai/storage";

describe("runShellWorkflowFromOverlay", () => {
  test("closes the top overlay before running workflow handlers", async () => {
    const dispatches: string[] = [];
    let executed = false;
    let modalCount = 1;
    const container = {
      stateManager: {
        getState: () => ({ activeModals: Array.from({ length: modalCount }) }),
        dispatch: (event: { type: string }) => {
          dispatches.push(event.type);
          if (event.type === "CLOSE_TOP_OVERLAY") modalCount = 0;
        },
      },
    } as unknown as Container;

    const result = await runShellWorkflowFromOverlay(container, "setup", {
      execute: async () => {
        executed = true;
        return "handled";
      },
    });

    expect(dispatches[0]).toBe("CLOSE_TOP_OVERLAY");
    expect(executed).toBe(true);
    expect(result).toBe("handled");
  });
});

/**
 * The "Download queued: …" toast is the only confirmation a user gets that a
 * download exists, so it has to name the item the same way every other surface
 * does. It used to synthesize `S01E01` from `season ?? 1`, which meant queuing
 * a movie reported an episode that does not exist.
 */
describe("enqueueCurrentPlaybackDownload feedback", () => {
  function createContainer(
    job: Partial<DownloadJobRecord> & Pick<DownloadJobRecord, "titleName" | "mediaKind">,
    playback: {
      readonly mode?: string;
      readonly titleType?: "movie" | "series";
      readonly episode?: { season: number; episode: number };
    } = {},
  ): { container: Container; notes: (string | null)[] } {
    const notes: (string | null)[] = [];
    const languageProfile = { audio: "en", subtitle: "en", quality: "1080p" };
    const state = {
      currentTitle: { id: "t1", type: playback.titleType ?? "series", name: job.titleName },
      currentEpisode: playback.episode ?? { season: 1, episode: 1 },
      mode: playback.mode ?? "series",
      stream: undefined,
      provider: "provider-1",
      animeLanguageProfile: languageProfile,
      movieLanguageProfile: languageProfile,
      seriesLanguageProfile: languageProfile,
      playbackNote: null as string | null,
    };

    const container = {
      config: {
        defaultDownloadQuality: "1080p",
        youtubeLanguageProfile: languageProfile,
      },
      stateManager: {
        getState: () => state,
        dispatch: (event: { type: string; note?: string | null }) => {
          if (event.type === "SET_PLAYBACK_FEEDBACK") notes.push(event.note ?? null);
        },
      },
      diagnosticsService: { record: () => {} },
      playerControl: { waitForActivePlayer: async () => null },
      downloadService: {
        getEnqueueEligibility: () => ({ allowed: true }),
        enqueue: async () =>
          ({
            id: "job-1",
            titleId: "t1",
            providerId: "provider-1",
            outputPath: "/downloads/out.mp4",
            ...job,
          }) as DownloadJobRecord,
        kickQueue: () => {},
      },
    } as unknown as Container;

    return { container, notes };
  }

  test("a movie job is queued as Movie, never as a synthetic S01E01", async () => {
    const { container, notes } = createContainer(
      { titleName: "Dune: Part Two", mediaKind: "movie", season: 1, episode: 1 },
      { titleType: "movie" },
    );

    await expect(enqueueCurrentPlaybackDownload({ container, reason: "test" })).resolves.toBe(true);

    expect(notes[0]).toBe("Download queued: Dune: Part Two · Movie");
    expect(notes[0]).not.toContain("S01E01");
  });

  test("a series job keeps its season and episode position", async () => {
    const { container, notes } = createContainer(
      { titleName: "Severance", mediaKind: "series", season: 1, episode: 3 },
      { episode: { season: 1, episode: 3 } },
    );

    await enqueueCurrentPlaybackDownload({ container, reason: "test" });

    expect(notes[0]).toBe("Download queued: Severance · S01E03");
  });

  test("an anime job is episode-only by default", async () => {
    const { container, notes } = createContainer(
      { titleName: "Frieren", mediaKind: "anime", season: 1, episode: 3 },
      { mode: "anime", episode: { season: 1, episode: 3 } },
    );

    await enqueueCurrentPlaybackDownload({ container, reason: "test" });

    expect(notes[0]).toBe("Download queued: Frieren · E03");
  });

  test("a video job names its kind instead of an episode code", async () => {
    const { container, notes } = createContainer(
      { titleName: "Kunai Release Trailer", mediaKind: "video" },
      { mode: "youtube" },
    );

    await enqueueCurrentPlaybackDownload({ container, reason: "test" });

    expect(notes[0]).toBe("Download queued: Kunai Release Trailer · Video");
    expect(notes[0]).not.toMatch(/E\d/);
  });
});
