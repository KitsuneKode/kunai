import { expect, test } from "bun:test";

import { enqueueReleaseReconciliation } from "@/services/release-reconciliation/enqueue-release-reconciliation";

test("release reconciliation triggers share one coalescing scheduler identity", () => {
  const ids: string[] = [];
  const container = {
    config: { powerSaverMode: false },
    offlineTitlePolicies: { get: () => undefined },
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
});

test("power saver suppresses passive release reconciliation while allowing explicit history refresh", () => {
  const ids: string[] = [];
  const container = {
    config: { powerSaverMode: true },
    offlineTitlePolicies: { get: () => undefined },
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

  expect(ids).toEqual(["release-reconciliation"]);
});
