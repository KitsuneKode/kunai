import { afterEach, expect, test } from "bun:test";

import { LibraryTitleDetail } from "@/app-shell/library-title-detail";
import {
  forceSettleAllRootContent,
  getRootContentSession,
  type RootContentSession,
} from "@/app-shell/root-content-state";
import type { Container } from "@/container";
import { createOfflineLibraryEngine } from "@/domain/offline/OfflineLibraryEngine";
import type { OfflineLibraryEntry } from "@/services/offline/offline-library";
import type { DownloadJobRecord } from "@kunai/storage";
import React from "react";

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
