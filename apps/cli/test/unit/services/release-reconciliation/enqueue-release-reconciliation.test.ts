import { expect, test } from "bun:test";

import { enqueueReleaseReconciliation } from "@/services/release-reconciliation/enqueue-release-reconciliation";

test("release reconciliation triggers share one coalescing scheduler identity", () => {
  const ids: string[] = [];
  let policyLookups = 0;
  const container = {
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
    diagnosticsStore: { record: () => {} },
  };
  const entries = [
    [
      "anilist:1",
      {
        title: "Anime",
        type: "series",
        mediaKind: "anime",
        season: 1,
        episode: 1,
        timestamp: 100,
        duration: 1200,
        completed: true,
        provider: "allmanga",
        watchedAt: "2026-05-23T12:00:00.000Z",
      },
    ],
  ] as const;

  enqueueReleaseReconciliation(container as never, entries, "startup");
  enqueueReleaseReconciliation(container as never, entries, "history");

  expect(ids).toEqual(["release-reconciliation", "release-reconciliation"]);
  expect(policyLookups).toBe(2);
});

test("power saver suppresses passive release reconciliation from browse and history surfaces", () => {
  const ids: string[] = [];
  const container = {
    config: { powerSaverMode: true },
    offlineTitlePolicies: { listByTitleIds: () => [] },
    backgroundWorkScheduler: {
      enqueue: (item: { readonly id: string }) => ids.push(item.id),
      drain: async () => ({ completed: [], failed: [], skipped: [] }),
    },
    releaseReconciliationService: { reconcile: async () => ({ skipped: [] }) },
    diagnosticsStore: { record: () => {} },
  };
  const entries = [
    [
      "anilist:1",
      {
        title: "Anime",
        type: "series",
        mediaKind: "anime",
        season: 1,
        episode: 1,
        timestamp: 100,
        duration: 1200,
        completed: true,
        provider: "allmanga",
        watchedAt: "2026-05-23T12:00:00.000Z",
      },
    ],
  ] as const;

  enqueueReleaseReconciliation(container as never, entries, "browse-idle");
  enqueueReleaseReconciliation(container as never, entries, "history");

  expect(ids).toEqual([]);
});

test("release reconciliation batches offline policy attention lookup once per trigger", async () => {
  const attentionInputs: unknown[] = [];
  const runs: Promise<void>[] = [];
  let lookupCalls = 0;
  const container = {
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
    diagnosticsStore: { record: () => {} },
  };
  const entries = [
    [
      "anilist:1",
      {
        title: "Anime 1",
        type: "series",
        mediaKind: "anime",
        season: 1,
        episode: 1,
        timestamp: 100,
        duration: 1200,
        completed: true,
        provider: "allmanga",
        watchedAt: "2026-05-23T12:00:00.000Z",
      },
    ],
    [
      "anilist:2",
      {
        title: "Anime 2",
        type: "series",
        mediaKind: "anime",
        season: 1,
        episode: 2,
        timestamp: 100,
        duration: 1200,
        completed: true,
        provider: "allmanga",
        watchedAt: "2026-05-23T12:00:00.000Z",
      },
    ],
  ] as const;

  enqueueReleaseReconciliation(container as never, entries, "history");
  await Promise.all(runs);

  expect(lookupCalls).toBe(1);
  expect(attentionInputs).toEqual([
    { "anilist:1": "continue-visible", "anilist:2": "offline-enrolled" },
  ]);
});
