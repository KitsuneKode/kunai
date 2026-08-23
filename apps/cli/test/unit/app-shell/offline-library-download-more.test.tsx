import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LibraryTitleDetail } from "@/app-shell/library-title-detail";
import {
  forceSettleAllRootContent,
  getRootContentSession,
  type RootContentSession,
} from "@/app-shell/root-content-state";
import type { Container } from "@/container";
import { createOfflineLibraryEngine } from "@/domain/offline/OfflineLibraryEngine";
import { DownloadService, type EnqueueDownloadInput } from "@/services/download/DownloadService";
import type { OfflineLibraryEntry } from "@/services/offline/offline-library";
import type { ConfigService } from "@/services/persistence/ConfigService";
import {
  DownloadJobsRepository,
  openKunaiDatabase,
  runMigrations,
  type DownloadJobRecord,
} from "@kunai/storage";
import React, { act } from "react";

import { render, stripAnsi } from "../../harness/render-capture";
import { createSessionStateFixture } from "../../support/session-state-fixture";

const LEGACY_ANIME_JOB = {
  id: "anime-film-legacy-job",
  titleId: "anime-film-1",
  titleName: "Infinity Castle",
  mediaKind: "anime",
  mode: "anime",
  // Migration 028 deliberately leaves old rows unresolved. The selected shelf
  // partition, not this synthetic legacy position, owns the title structure.
  season: 1,
  episode: 1,
  outputPath: "/tmp/infinity-castle.mp4",
  tempPath: "/tmp/infinity-castle.part",
  streamUrl: "https://example.invalid/infinity-castle",
  headers: {},
  status: "completed",
  progressPercent: 100,
  fileSize: 1024,
  retryCount: 0,
  attempt: 1,
  maxAttempts: 3,
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
  completedAt: "2026-08-16T00:00:00.000Z",
  providerId: "allanime",
} as DownloadJobRecord;

const ENTRY: OfflineLibraryEntry = { job: LEGACY_ANIME_JOB, status: "ready" };

function createContainer(): Container {
  let state = createSessionStateFixture({ mode: "anime", provider: "allanime" });
  return {
    config: {
      zenMode: false,
      downloadPath: "",
      offlineArtworkCacheEnabled: false,
      offlineDefaultRunwayTarget: 2,
      autoCleanupGraceDays: 7,
      protectedDownloadJobIds: [],
      youtubeLanguageProfile: { audio: "original", subtitle: "none" },
    },
    shellChrome: "minimal",
    stateManager: {
      getState: () => state,
      dispatch: (event: { type: string; mode?: typeof state.mode; provider?: string }) => {
        if (event.type === "SET_MODE" && event.mode) {
          state = { ...state, mode: event.mode, provider: event.provider ?? state.provider };
        }
        if (event.type === "SET_PROVIDER" && event.provider) {
          state = { ...state, provider: event.provider };
        }
      },
    },
    providerRegistry: { get: () => undefined },
    downloadService: {
      getEnqueueEligibility: () => ({ allowed: true }),
    },
    offlineTitlePolicies: { get: () => undefined },
    historyRepository: {
      getLatestForTitleIdentity: () => null,
      listByTitle: () => [],
    },
    connectivity: {
      isOnline: () => true,
      subscribe: () => () => undefined,
    },
    diagnosticsService: { record: () => undefined },
  } as unknown as Container;
}

async function waitForRootContent(): Promise<RootContentSession> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const session = getRootContentSession();
    if (session) return session;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("download-more did not mount a root-content flow");
}

async function captureDownloadMoreFlow(contentType: "movie" | "series"): Promise<string> {
  forceSettleAllRootContent("offline-download-more-test-start");
  const unresolvedGroup = createOfflineLibraryEngine().buildShelf([ENTRY]).groups[0];
  if (!unresolvedGroup) throw new Error("expected an offline library group");
  const group = {
    ...unresolvedGroup,
    contentType,
  };
  const detailHandle = render(
    <LibraryTitleDetail
      container={createContainer()}
      group={group}
      entries={[ENTRY]}
      onBack={() => undefined}
      onEntriesChanged={() => undefined}
    />,
    { columns: 120, rows: 40 },
  );
  // One persisted item, then the online action, then download-more.
  detailHandle.stdin.enqueue("\u001b[B");
  detailHandle.stdin.enqueue("\u001b[B");
  detailHandle.stdin.enqueue("\r");
  const session = await waitForRootContent();
  const flowHandle = render(session.element, { columns: 120, rows: 40 });
  try {
    return stripAnsi(flowHandle.lastFrame() ?? "");
  } finally {
    flowHandle.unmount();
    detailHandle.unmount();
    forceSettleAllRootContent("offline-download-more-test-finish");
  }
}

afterEach(() => {
  forceSettleAllRootContent("offline-download-more-test-cleanup");
});

test("anime movie download-more opens title-level confirmation from group structure", async () => {
  const frame = await captureDownloadMoreFlow("movie");

  expect(frame).toContain("Download Infinity Castle?");
  expect(frame).toContain("1 movie");
  expect(frame).not.toContain("Episode metadata unavailable");
  expect(frame).not.toContain("Start episode 1");
});

test("anime series download-more remains episodic", async () => {
  const frame = await captureDownloadMoreFlow("series");

  expect(frame).toContain("Episode metadata unavailable");
  expect(frame).toContain("Start episode 1");
  expect(frame).not.toContain("Download Infinity Castle?");
});

test("anime movie download-more restores its persisted lane before actual enqueue", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "kunai-offline-anime-film-"));
  const db = openKunaiDatabase(join(tempDir, "data.sqlite"));
  runMigrations(db, "data");
  const repo = new DownloadJobsRepository(db);
  const config = {
    zenMode: false,
    downloadsEnabled: true,
    downloadPath: tempDir,
    offlineArtworkCacheEnabled: false,
    offlineDefaultRunwayTarget: 2,
    offlineFreeSpaceReserveBytes: 0,
    offlineUnknownEpisodeEstimateBytes: 1,
    autoCleanupGraceDays: 7,
    protectedDownloadJobIds: [],
    youtubeLanguageProfile: { audio: "original", subtitle: "none" },
  } as unknown as ConfigService;
  const service = new DownloadService({
    repo,
    titleAliases: { upsertAliases: () => undefined },
    config,
    ytDlpAvailable: true,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      fatal: () => undefined,
      child() {
        return this;
      },
    },
  });
  const enqueueInputs: EnqueueDownloadInput[] = [];
  let state = createSessionStateFixture({ mode: "series", provider: "vidking" });
  const legacyJob = {
    ...LEGACY_ANIME_JOB,
    id: "retired-anime-film",
    providerId: "retired-anime-provider",
    mode: undefined,
  } as DownloadJobRecord;
  const entry: OfflineLibraryEntry = { job: legacyJob, status: "ready" };
  const unresolvedGroup = createOfflineLibraryEngine().buildShelf([entry]).groups[0];
  if (!unresolvedGroup) throw new Error("expected an offline library group");
  const container = {
    config,
    shellChrome: "minimal",
    stateManager: {
      getState: () => state,
      dispatch: (event: { type: string; mode?: typeof state.mode; provider?: string }) => {
        if (event.type === "SET_MODE" && event.mode) {
          state = { ...state, mode: event.mode, provider: event.provider ?? state.provider };
        }
        if (event.type === "SET_PROVIDER" && event.provider) {
          state = { ...state, provider: event.provider };
        }
      },
    },
    providerRegistry: { get: () => undefined },
    downloadService: {
      getEnqueueEligibility: () => service.getEnqueueEligibility(),
      enqueue: async (input: EnqueueDownloadInput) => {
        enqueueInputs.push(input);
        return await service.enqueue(input);
      },
      // Persistence is the boundary under test; do not start the worker.
      kickQueue: () => undefined,
    },
    offlineTitlePolicies: { get: () => undefined },
    offlineRunwayService: { enqueueEvaluation: () => undefined },
    historyRepository: {
      getLatestForTitleIdentity: () => null,
      listByTitle: () => [],
    },
    connectivity: {
      isOnline: () => true,
      subscribe: () => () => undefined,
    },
    diagnosticsService: { record: () => undefined },
  } as unknown as Container;

  const detailHandle = render(
    <LibraryTitleDetail
      container={container}
      group={{ ...unresolvedGroup, contentType: "movie" }}
      entries={[entry]}
      onBack={() => undefined}
      onEntriesChanged={() => undefined}
    />,
    { columns: 120, rows: 40 },
  );
  try {
    detailHandle.stdin.enqueue("\u001b[B");
    detailHandle.stdin.enqueue("\u001b[B");
    detailHandle.stdin.enqueue("\r");
    const confirmation = await waitForRootContent();
    const confirmationHandle = render(confirmation.element, { columns: 120, rows: 40 });
    try {
      expect(stripAnsi(confirmationHandle.lastFrame() ?? "")).toContain(
        "Download Infinity Castle?",
      );
      confirmationHandle.stdin.enqueue("\r");
      await act(async () => {
        for (let attempt = 0; attempt < 30 && repo.listQueued(10).length === 0; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await Promise.resolve();
      });
    } finally {
      confirmationHandle.unmount();
    }

    const stored = repo.listQueued(10)[0];
    expect(enqueueInputs).toHaveLength(1);
    expect(enqueueInputs[0]).toMatchObject({
      providerId: "retired-anime-provider",
      mode: "anime",
      episode: undefined,
      title: { type: "movie", isAnime: true },
    });
    expect(stored).toMatchObject({
      mediaKind: "anime",
      contentType: "movie",
      providerId: "retired-anime-provider",
      season: undefined,
      episode: undefined,
    });
  } finally {
    detailHandle.unmount();
    forceSettleAllRootContent("offline-download-more-enqueue-test-finish");
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
