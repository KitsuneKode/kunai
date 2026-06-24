import { describe, expect, test } from "bun:test";

import {
  buildOfflinePlaybackLaunch,
  requestUnifiedOfflinePlayback,
} from "@/app/offline/offline-playback-launch";
import type { Container } from "@/container";
import type { DownloadJobRecord } from "@kunai/storage";

function readyJob(overrides: Partial<DownloadJobRecord> = {}): DownloadJobRecord {
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
  test("returns direct handoff without module-global mailbox", async () => {
    const dispatches: string[] = [];
    const container = {
      config: { offlineMode: false },
      stateManager: {
        dispatch: (event: { type: string }) => {
          dispatches.push(event.type);
        },
        getState: () => ({ provider: "vidking" }),
      },
      offlineLibraryService: {
        getPlayableSource: async () => ({
          status: "ready" as const,
          job: readyJob(),
        }),
      },
    } as unknown as Container;

    const result = await requestUnifiedOfflinePlayback(container, "job-1");
    expect(result).toEqual({
      status: "direct",
      launch: buildOfflinePlaybackLaunch(readyJob()),
    });
    expect(dispatches).toContain("SELECT_TITLE");
    expect(dispatches).toContain("CLOSE_TOP_OVERLAY");
  });
});
