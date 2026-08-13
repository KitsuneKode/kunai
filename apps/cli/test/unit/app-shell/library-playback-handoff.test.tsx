import { expect, test } from "bun:test";

import { LibraryShell } from "@/app-shell/library-shell";
import { handleShellAction } from "@/app-shell/workflows";
import type { Container } from "@/container";
import type { OfflineLibraryEntry } from "@/services/offline/offline-library";
import type { DownloadJobRecord } from "@kunai/storage";
import React, { act } from "react";

import { render } from "../../harness/render-capture";
import { createContainerFixture } from "../../support/container-fixture";

const JOB = {
  id: "job-1",
  titleId: "title-1",
  titleName: "Dune: Prophecy",
  mediaKind: "series",
  mode: "series",
  season: 1,
  episode: 2,
  outputPath: "/tmp/dune-prophecy-s01e02.mp4",
  tempPath: "/tmp/dune-prophecy-s01e02.part",
  streamUrl: "https://example.invalid/dune-prophecy",
  headers: {},
  status: "completed",
  progressPercent: 100,
  fileSize: 1024 * 1024,
  retryCount: 0,
  attempt: 1,
  maxAttempts: 3,
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
  completedAt: "2026-08-14T00:00:00.000Z",
  providerId: "vidking",
} as DownloadJobRecord;

const ENTRY: OfflineLibraryEntry = { job: JOB, status: "ready" };

async function waitForFrame(
  handle: { lastFrame: () => string | undefined },
  needle: string,
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (handle.lastFrame()?.includes(needle)) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`frame never contained ${JSON.stringify(needle)}\n${handle.lastFrame() ?? ""}`);
}

test("/library returns the selected offline episode to the session workflow", async () => {
  const { container: overlayContainer } = createContainerFixture();
  const container = {
    ...overlayContainer,
    config: {
      zenMode: false,
      downloadsEnabled: true,
      protectedDownloadJobIds: [] as string[],
      update: async () => undefined,
      save: async () => undefined,
    },
    downloadService: {
      listActive: () => [],
      listCompleted: () => [],
      listFailed: () => [],
      onEvent: () => () => undefined,
      deleteJob: () => undefined,
      abort: async () => undefined,
      retry: async () => undefined,
      processQueue: async () => undefined,
      repairRepairableSidecars: async () => ({
        checked: 0,
        repaired: 0,
        stillRepairable: 0,
        failed: 0,
      }),
    },
    offlineLibraryService: {
      listCompletedEntries: async () => [ENTRY],
      getPlayableSource: async () => ({ status: "ready" as const, job: JOB }),
    },
    historyRepository: {
      listLatestByTitle: () => [],
      listByTitle: () => [],
    },
    connectivity: {
      isOnline: () => false,
      subscribe: () => () => undefined,
    },
  } as unknown as Container;

  const workflowResult = handleShellAction({ action: "library", container });
  await Promise.resolve();

  const handle = render(<LibraryShell container={container} onClose={() => {}} />, {
    columns: 100,
    rows: 40,
  });
  try {
    await waitForFrame(handle, "Dune: Prophecy");
    handle.stdin.enqueue("\r");
    await waitForFrame(handle, "Continue this title online");
    handle.stdin.enqueue("\r");

    let result: Awaited<typeof workflowResult> | undefined;
    await act(async () => {
      result = await workflowResult;
      await Promise.resolve();
    });
    expect(result).toEqual({
      type: "history-entry",
      title: {
        id: "title-1",
        type: "series",
        name: "Dune: Prophecy",
        isAnime: false,
        launchSource: "offline-library",
      },
      episode: { season: 1, episode: 2 },
    });
  } finally {
    handle.unmount();
  }
});
