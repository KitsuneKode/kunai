import { expect, test } from "bun:test";

import { DownloadManagerContent } from "@/app-shell/download-manager-shell";
import type { Container } from "@/container";
import type { DownloadJobRecord } from "@kunai/storage";
import React, { act } from "react";

import { render } from "../../harness/render-capture";

type DownloadEvent = { readonly type: string };

function queuedJob(overrides: Partial<DownloadJobRecord> = {}): DownloadJobRecord {
  return {
    id: "job-1",
    titleId: "title-1",
    titleName: "Frieren",
    status: "queued",
    mode: "series",
    providerId: "videasy",
    season: 1,
    episode: 3,
    createdAt: new Date("2026-06-24T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-06-24T00:00:00.000Z").toISOString(),
    progressPercent: 0,
    outputPath: "/tmp/frieren-s01e03.mp4",
    ...overrides,
  } as DownloadJobRecord;
}

function createContainerFixture() {
  let listener: ((event: DownloadEvent) => void) | null = null;
  let activeJobs: DownloadJobRecord[] = [];
  let completedJobs: DownloadJobRecord[] = [];
  let failedJobs: DownloadJobRecord[] = [];

  const container = {
    config: {
      zenMode: false,
    },
    downloadService: {
      listActive: () => activeJobs,
      listCompleted: () => completedJobs,
      listFailed: () => failedJobs,
      onEvent: (nextListener: (event: DownloadEvent) => void) => {
        listener = nextListener;
        return () => {
          listener = null;
        };
      },
      repairRepairableSidecars: async () => ({
        checked: 0,
        repaired: 0,
        stillRepairable: 0,
        failed: 0,
      }),
      abort: async () => undefined,
      deleteJob: async () => undefined,
      retry: async () => undefined,
      processQueue: async () => undefined,
    },
  } as unknown as Container;

  return {
    container,
    setActiveJobs(nextJobs: DownloadJobRecord[]) {
      activeJobs = nextJobs;
    },
    setCompletedJobs(nextJobs: DownloadJobRecord[]) {
      completedJobs = nextJobs;
    },
    setFailedJobs(nextJobs: DownloadJobRecord[]) {
      failedJobs = nextJobs;
    },
    emit(event: DownloadEvent) {
      act(() => {
        listener?.(event);
      });
    },
  };
}

test("download manager ignores empty-list arrows and selects the first later job", () => {
  const fixture = createContainerFixture();
  const handle = render(
    <DownloadManagerContent container={fixture.container} onClose={() => undefined} />,
    { columns: 120, rows: 35 },
  );

  try {
    expect(handle.lastFrame()).toContain("No downloads queued");

    handle.stdin.enqueue("\u001b[B");
    handle.stdin.enqueue("\u001b[A");

    fixture.setActiveJobs([queuedJob()]);
    fixture.emit({ type: "enqueued" });

    const frame = handle.lastFrame();
    expect(frame).toContain("Frieren");
    expect(frame).toContain("x to remove from queue");
  } finally {
    handle.unmount();
  }
});
