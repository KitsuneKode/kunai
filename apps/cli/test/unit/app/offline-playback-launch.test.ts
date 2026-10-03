import { describe, expect, test } from "bun:test";

import {
  buildOfflinePlaybackLaunch,
  prepareOfflinePlaybackLaunch,
  requestUnifiedOfflinePlayback,
  titleInfoFromDownloadJob,
} from "@/app/offline/offline-playback-launch";
import type { Container } from "@/container";
import { buildLocalPlaybackSource } from "@/services/offline/local-playback-source";
import type { DownloadJobRecord } from "@kunai/storage";

import { createTestStateManager } from "../../helpers/session-state";

function readyJob(overrides: Partial<DownloadJobRecord> = {}): DownloadJobRecord {
  // SAFETY: Synthetic job supplies all fields read by the launch projection; persistence is not used.
  return {
    id: "job-1",
    titleId: "tv:demo",
    titleName: "Demo",
    mediaKind: "series",
    mode: "series",
    season: 1,
    episode: 1,
    status: "completed",
    outputPath: "/tmp/demo.mkv",
    ...overrides,
  } as DownloadJobRecord;
}

describe("requestUnifiedOfflinePlayback", () => {
  for (const mode of ["series", "anime", "youtube"] as const) {
    test(`${mode}: offline launch preserves retired provider provenance without registry lookup`, async () => {
      const job = readyJob({
        providerId: "retired-provider",
        mode,
        mediaKind: mode === "anime" ? "anime" : mode === "youtube" ? "video" : "series",
      });
      const dispatches: Array<{ type: string; provider?: string; mode?: string }> = [];
      const stateManager = createTestStateManager("current-provider");
      const dispatch = stateManager.dispatch.bind(stateManager);
      stateManager.dispatch = (event) => {
        dispatches.push(event);
        dispatch(event);
      };
      // SAFETY: Real session state; service double only supplies the playable job consumed here.
      const container = {
        stateManager,
        offlineLibraryService: {
          getPlayableSource: async (
            _jobId: string,
          ): ReturnType<Container["offlineLibraryService"]["getPlayableSource"]> => ({
            status: "ready",
            job,
            source: buildLocalPlaybackSource(job, null),
          }),
        },
        providerRegistry: {
          get: (_id: string): ReturnType<Container["providerRegistry"]["get"]> => {
            throw new Error("offline launch must not read providers");
          },
        },
      } as Container;
      const launch = await prepareOfflinePlaybackLaunch(container, job.id);
      expect(launch?.title.launchSource).toBe("offline-library");
      expect(dispatches).toContainEqual({ type: "SET_MODE", mode, provider: "retired-provider" });
    });
  }

  test("returns direct handoff without module-global mailbox", async () => {
    const dispatches: string[] = [];
    const stateManager = createTestStateManager();
    const dispatch = stateManager.dispatch.bind(stateManager);
    stateManager.dispatch = (event) => {
      dispatches.push(event.type);
      dispatch(event);
    };
    // SAFETY: Real session state; service double only supplies the playable job consumed here.
    const container = {
      stateManager,
      offlineLibraryService: {
        getPlayableSource: async (
          _jobId: string,
        ): ReturnType<Container["offlineLibraryService"]["getPlayableSource"]> => ({
          status: "ready",
          job: readyJob(),
          source: buildLocalPlaybackSource(readyJob(), null),
        }),
      },
    } as Container;

    const result = await requestUnifiedOfflinePlayback(container, "job-1");
    expect(result).toEqual({
      status: "direct",
      launch: buildOfflinePlaybackLaunch(readyJob()),
    });
    expect(dispatches).toContain("SELECT_TITLE");
    expect(dispatches).toContain("CLOSE_TOP_OVERLAY");
  });

  test("preserves video mode and marks library launches as local-only", () => {
    const title = titleInfoFromDownloadJob(
      readyJob({ mediaKind: "video", mode: "youtube", season: undefined, episode: undefined }),
    );

    expect(title).toMatchObject({
      type: "movie",
      launchSource: "offline-library",
    });
  });

  test("replays an anime film with movie structure and no synthetic episode", () => {
    const launch = buildOfflinePlaybackLaunch(
      readyJob({
        titleId: "anilist:181053",
        titleName: "Infinity Castle",
        mediaKind: "anime",
        contentType: "movie",
        mode: "anime",
        season: undefined,
        episode: undefined,
      }),
    );

    expect(launch).toEqual({
      title: {
        id: "anilist:181053",
        type: "movie",
        name: "Infinity Castle",
        isAnime: true,
        launchSource: "offline-library",
      },
      episode: undefined,
    });
  });
});
