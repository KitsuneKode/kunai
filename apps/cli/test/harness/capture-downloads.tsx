// =============================================================================
// capture-downloads.tsx — real download-manager frames at 72 / 100 / 140.
//
// Mounts the ACTUAL `DownloadManagerContent` inside a width-reactive
// `OverlayLayoutProvider`, so each capture sees the same content-column budget
// the shell gives it at that terminal width. A single static provider value
// would make all three captures render the same layout and hide exactly the
// overflow these files exist to catch.
//
// Poster rendering is disabled through the real capability gate, so a capture
// performs no network, subprocess, or timer work.
// =============================================================================

process.env.KUNAI_POSTER = "0";

import { DownloadManagerContent } from "@/app-shell/download-manager-shell";
import { OverlayLayoutProvider } from "@/app-shell/overlay-layout-context";
import { useShellDimensions } from "@/app-shell/use-viewport-policy";
import type { Container } from "@/container";
import type { DownloadJobRecord } from "@kunai/storage";
import React, { useMemo } from "react";

import { captureSurface } from "./render-capture";

function job(overrides: Partial<DownloadJobRecord>): DownloadJobRecord {
  return {
    id: "job",
    titleId: "title",
    titleName: "Title",
    status: "queued",
    mediaKind: "series",
    mode: "series",
    providerId: "videasy",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    progressPercent: 0,
    outputPath: "/tmp/title.mp4",
    // Title-owned poster identity: present on the record, never fetched here.
    posterUrl: "https://img.example/poster.jpg",
    ...overrides,
  } as DownloadJobRecord;
}

const activeJobs: DownloadJobRecord[] = [
  job({
    id: "running-series",
    titleId: "severance",
    titleName: "Severance",
    status: "running",
    mediaKind: "series",
    season: 2,
    episode: 4,
    progressPercent: 63,
  }),
  job({
    id: "queued-anime",
    titleId: "frieren",
    titleName: "Frieren: Beyond Journey's End",
    status: "queued",
    mediaKind: "anime",
    episode: 29,
  }),
  job({
    // Legacy movie row: persisted with a synthetic season 1 / episode 1 before
    // movies became title-level jobs. It must still read as a quiet "Movie".
    id: "legacy-movie",
    titleId: "dune-2",
    titleName: "Dune: Part Two",
    status: "queued",
    mediaKind: "movie",
    season: 1,
    episode: 1,
  }),
];

const failedJobs: DownloadJobRecord[] = [
  job({
    id: "repairable",
    titleId: "arcane",
    titleName: "Arcane",
    status: "repairable",
    mediaKind: "series",
    season: 1,
    episode: 9,
    progressPercent: 41,
  }),
];

const container = {
  config: { zenMode: false },
  downloadService: {
    listActive: () => activeJobs,
    listCompleted: () => [],
    listFailed: () => failedJobs,
    onEvent: () => () => undefined,
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

/** Rebuilds the overlay budget from the live terminal size on every mount. */
function DownloadsCapture() {
  const { cols, rows } = useShellDimensions();
  const layout = useMemo(
    () => ({
      contentColumns: cols,
      contentRows: Math.max(12, rows - 6),
      chromeRows: 6,
      listMaxVisible: Math.max(4, rows - 12),
    }),
    [cols, rows],
  );
  return (
    <OverlayLayoutProvider value={layout}>
      <DownloadManagerContent container={container} onClose={() => undefined} />
    </OverlayLayoutProvider>
  );
}

await captureSurface("downloads", <DownloadsCapture />);
console.log("captured download manager");
process.exit(0);
