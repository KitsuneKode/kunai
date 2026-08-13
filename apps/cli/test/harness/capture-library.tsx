// =============================================================================
// capture-library.tsx — real LibraryShell frames at 72 / 100 / 140.
//
// Mounts the ACTUAL exported `LibraryShell` instead of a hand-built preview, so
// a capture can fail when the shipped shelf breaks. The offline read is the
// surface's only async input, so each fixture owns a deferred gate that
// `settle()` resolves — no sleeps, no timers, no network, no subprocess.
//
// Poster rendering goes through the real capability gate and is disabled here.
// =============================================================================

process.env.KUNAI_POSTER = "0";

import { LibraryShell } from "@/app-shell/library-shell";
import type { Container } from "@/container";
import type { OfflineLibraryEntry } from "@/services/offline/offline-library";
import React from "react";

import { captureSurfaceSettled } from "./render-capture";

function entry(job: Partial<OfflineLibraryEntry["job"]>): OfflineLibraryEntry {
  return {
    job: {
      id: "job",
      titleId: "title",
      titleName: "Title",
      mediaKind: "series",
      outputPath: "/tmp/title.mp4",
      tempPath: "/tmp/title.part",
      streamUrl: "https://example/title",
      headers: {},
      status: "completed",
      progressPercent: 100,
      fileSize: 734_003_200,
      retryCount: 0,
      attempt: 1,
      maxAttempts: 3,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-01T00:00:00.000Z",
      providerId: "vidking",
      // Title-owned poster identity: present on the record, never fetched here.
      posterUrl: "https://img.example/poster.jpg",
      ...job,
    },
    status: "ready",
  } as OfflineLibraryEntry;
}

const POPULATED_ENTRIES: readonly OfflineLibraryEntry[] = [
  entry({
    id: "dune-2",
    titleId: "dune-2",
    titleName: "Dune: Part Two",
    mediaKind: "movie",
    outputPath: "/tmp/dune-part-two.mp4",
  }),
  entry({
    id: "severance-s02e04",
    titleId: "severance",
    titleName: "Severance",
    mediaKind: "series",
    season: 2,
    episode: 4,
    outputPath: "/tmp/severance-s02e04.mp4",
  }),
  entry({
    id: "frieren-e29",
    titleId: "frieren",
    titleName: "Frieren: Beyond Journey's End",
    mediaKind: "anime",
    episode: 29,
    outputPath: "/tmp/frieren-e29.mp4",
  }),
];

/** A container whose only async read is held open until the caller settles it. */
function gatedContainer(entries: readonly OfflineLibraryEntry[]) {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const container = {
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
      listCompletedEntries: async () => {
        await gate;
        return entries;
      },
    },
    historyRepository: {
      listLatestByTitle: () => [],
      listByTitle: () => [],
    },
    stateManager: { dispatch: () => undefined },
    connectivity: { isOnline: () => true, subscribe: () => () => undefined },
  } as unknown as Container;

  return {
    container,
    settle: async () => {
      open();
      await gate;
    },
  };
}

await captureSurfaceSettled("library-empty", () => {
  const { container, settle } = gatedContainer([]);
  return {
    node: <LibraryShell container={container} onClose={() => undefined} />,
    settle,
  };
});

await captureSurfaceSettled("library-populated", () => {
  const { container, settle } = gatedContainer(POPULATED_ENTRIES);
  return {
    node: <LibraryShell container={container} onClose={() => undefined} />,
    settle,
  };
});

console.log("captured library empty + populated");
process.exit(0);
