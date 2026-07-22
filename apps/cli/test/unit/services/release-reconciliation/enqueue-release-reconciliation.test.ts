import { expect, test } from "bun:test";

import {
  collectReleaseReconciliationRows,
  enqueueReleaseReconciliation,
  toReleaseReconciliationHistoryRows,
} from "@/services/release-reconciliation/enqueue-release-reconciliation";
import type { FollowedTitleRecord, HistoryProgress } from "@kunai/storage";

const baseReconciliationContainer = {
  featureFlags: { providerAvailabilitySync: false },
  attentionRefreshWorker: {
    runOnce: async () => ({
      status: "disabled" as const,
      refreshIds: [],
      skipped: [],
      refreshedIds: [],
      failed: [],
    }),
  },
};

function row(over: Partial<HistoryProgress> & { titleId: string }): HistoryProgress {
  return {
    key: "k",
    title: "Anime",
    mediaKind: "anime",
    season: 1,
    episode: 1,
    positionSeconds: 100,
    durationSeconds: 1200,
    completed: true,
    providerId: "allmanga",
    updatedAt: "2026-05-23T12:00:00.000Z",
    createdAt: "2026-05-23T12:00:00.000Z",
    ...over,
  };
}

test("collectReleaseReconciliationRows merges history with followed-only titles", () => {
  const historyRow = row({ titleId: "anilist:1", title: "Watched" });
  const followedOnly: FollowedTitleRecord = {
    titleId: "anilist:2",
    mediaKind: "anime",
    title: "Followed Only",
    preference: "following",
    updatedAt: "2026-05-24T12:00:00.000Z",
  };
  const container = {
    historyRepository: {
      listLatestByTitle: () => [historyRow],
    },
    followedTitleRepository: {
      listByPreference: () => [
        followedOnly,
        {
          titleId: "anilist:1",
          mediaKind: "anime",
          title: "Watched",
          preference: "following",
          updatedAt: "2026-05-24T12:00:00.000Z",
        } satisfies FollowedTitleRecord,
      ],
    },
  };

  const rows = collectReleaseReconciliationRows(container as never);

  expect(rows.map((entry) => entry.titleId)).toEqual(["anilist:1", "anilist:2"]);
  expect(rows[1]?.key).toBe("followed:anilist:2");
  expect(rows[1]?.episode).toBe(0);

  // The collected rows are worthless unless they survive conversion. Asserting
  // only the shape above is what let the followed-title drop ship: `0 ?? 1` is
  // 0, and the episode-cursor guard rejects episode <= 0, so the row vanished.
  const converted = toReleaseReconciliationHistoryRows(rows);
  expect(converted.map((entry) => entry.titleId)).toEqual(["anilist:1", "anilist:2"]);
});

test("a followed title with no watch history survives conversion and can be reconciled", () => {
  const followedOnly = [
    {
      key: "followed:anilist:99",
      titleId: "anilist:99",
      mediaKind: "anime" as const,
      title: "Followed but never started",
      season: 1,
      episode: 0,
      positionSeconds: 0,
      completed: false,
      updatedAt: "2026-05-24T12:00:00.000Z",
      createdAt: "2026-05-24T12:00:00.000Z",
    },
  ] as unknown as readonly HistoryProgress[];

  const converted = toReleaseReconciliationHistoryRows(followedOnly);

  // Without this the follow feature can never produce a new-episode notification:
  // the title is dropped before reconciliation ever sees it.
  expect(converted).toHaveLength(1);
  expect(converted[0]?.titleId).toBe("anilist:99");
  expect(converted[0]?.completed).toBe(false);
});

test("release reconciliation triggers share one coalescing scheduler identity", () => {
  const ids: string[] = [];
  let policyLookups = 0;
  const container = {
    ...baseReconciliationContainer,
    config: { powerSaverMode: false },
    offlineTitlePolicies: {
      listByTitleIds: (titleIds: readonly string[]) => {
        policyLookups += 1;
        expect(titleIds).toEqual(["anilist:1"]);
        return [];
      },
    },
    backgroundWorkScheduler: {
      enqueue: (item: { readonly id: string }) => ids.push(item.id),
      drain: async () => ({ completed: [], failed: [], skipped: [] }),
    },
    releaseReconciliationService: { reconcile: async () => ({ skipped: [] }) },
    diagnosticsService: { record: () => {} },
    followedTitleRepository: { listByPreference: () => [] },
    releaseProgressCache: { getByTitleIds: () => new Map() },
    notificationService: { recordSignals: () => {} },
  };
  const entries = [row({ titleId: "anilist:1" })];

  enqueueReleaseReconciliation(container as never, entries, "startup");
  enqueueReleaseReconciliation(container as never, entries, "history");

  expect(ids).toEqual(["release-reconciliation", "release-reconciliation"]);
  expect(policyLookups).toBe(2);
});

test("power saver suppresses passive release reconciliation from browse and history surfaces", () => {
  const ids: string[] = [];
  const container = {
    ...baseReconciliationContainer,
    config: { powerSaverMode: true },
    offlineTitlePolicies: { listByTitleIds: () => [] },
    backgroundWorkScheduler: {
      enqueue: (item: { readonly id: string }) => ids.push(item.id),
      drain: async () => ({ completed: [], failed: [], skipped: [] }),
    },
    releaseReconciliationService: { reconcile: async () => ({ skipped: [] }) },
    diagnosticsService: { record: () => {} },
    followedTitleRepository: { listByPreference: () => [] },
    releaseProgressCache: { getByTitleIds: () => new Map() },
    notificationService: { recordSignals: () => {} },
  };
  const entries = [row({ titleId: "anilist:1" })];

  enqueueReleaseReconciliation(container as never, entries, "browse-idle");
  enqueueReleaseReconciliation(container as never, entries, "history");

  expect(ids).toEqual([]);
});

test("release reconciliation batches offline policy attention lookup once per trigger", async () => {
  const attentionInputs: unknown[] = [];
  const runs: Promise<void>[] = [];
  let lookupCalls = 0;
  const container = {
    ...baseReconciliationContainer,
    config: { powerSaverMode: false },
    offlineTitlePolicies: {
      listByTitleIds: (titleIds: readonly string[]) => {
        lookupCalls += 1;
        expect(titleIds).toEqual(["anilist:1", "anilist:2"]);
        return [{ titleId: "anilist:2", enrolled: true }];
      },
    },
    backgroundWorkScheduler: {
      enqueue: (item: { readonly run: () => Promise<void> }) => {
        runs.push(item.run());
      },
      drain: async () => ({ completed: [], failed: [], skipped: [] }),
    },
    releaseReconciliationService: {
      reconcile: async (input: { readonly attentionByTitleId: Map<string, string> }) => {
        attentionInputs.push(Object.fromEntries(input.attentionByTitleId));
        return { candidateCount: 0, fetchedCount: 0, writtenCount: 0, skipped: [] };
      },
    },
    diagnosticsService: { record: () => {} },
    followedTitleRepository: { listByPreference: () => [] },
    releaseProgressCache: { getByTitleIds: () => new Map() },
    notificationService: { recordSignals: () => {} },
  };
  const entries = [
    row({ titleId: "anilist:1", title: "Anime 1", episode: 1 }),
    row({ titleId: "anilist:2", title: "Anime 2", episode: 2 }),
  ];

  enqueueReleaseReconciliation(container as never, entries, "history");
  await Promise.all(runs);

  expect(lookupCalls).toBe(1);
  expect(attentionInputs).toEqual([
    { "anilist:1": "continue-visible", "anilist:2": "offline-enrolled" },
  ]);
});

test("release reconciliation completion callback runs after cache write pass", async () => {
  const events: string[] = [];
  const runs: Promise<void>[] = [];
  const container = {
    ...baseReconciliationContainer,
    config: { powerSaverMode: false },
    offlineTitlePolicies: { listByTitleIds: () => [] },
    backgroundWorkScheduler: {
      enqueue: (item: { readonly run: () => Promise<void> }) => {
        runs.push(item.run());
      },
      drain: async () => ({ completed: [], failed: [], skipped: [] }),
    },
    releaseReconciliationService: {
      reconcile: async () => {
        events.push("reconcile");
        return { candidateCount: 1, fetchedCount: 1, writtenCount: 1, skipped: [] };
      },
    },
    diagnosticsService: {
      record: () => events.push("diagnostics"),
    },
    followedTitleRepository: { listByPreference: () => [] },
    releaseProgressCache: { getByTitleIds: () => new Map() },
    notificationService: { recordSignals: () => {} },
  };

  enqueueReleaseReconciliation(
    container as never,
    [row({ titleId: "anilist:1" })],
    "history",
    undefined,
    {
      onComplete: () => {
        events.push("complete");
      },
    },
  );
  await Promise.all(runs);

  expect(events).toEqual(["reconcile", "diagnostics", "complete"]);
});
