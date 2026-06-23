import { expect, test } from "bun:test";

import { buildContinueHubView } from "@/app-shell/continue-hub-view";
import type { ContinuationHubRow } from "@/services/continuation/ContinueWatchingService";
import type { HistoryProgress } from "@kunai/storage";

function history(id: string): HistoryProgress {
  return {
    key: `series:${id}:1:1:none`,
    titleId: id,
    title: id,
    mediaKind: "series",
    season: 1,
    episode: 1,
    absoluteEpisode: undefined,
    providerId: undefined,
    positionSeconds: 0,
    durationSeconds: 1200,
    completed: false,
    updatedAt: "2026-06-01T00:00:00.000Z",
    createdAt: "2026-06-01T00:00:00.000Z",
    posterUrl: undefined,
    externalIds: undefined,
  };
}

function row(patch: Partial<ContinuationHubRow> & Pick<ContinuationHubRow, "id" | "group">) {
  const sourceEntry = history(patch.id);
  const target = {
    titleId: patch.id,
    title: patch.title ?? patch.id,
    mediaKind: "series" as const,
    season: 1,
    episode: 2,
    sourceEntry,
  };
  return {
    title: patch.title ?? patch.id,
    state: "resume",
    target,
    badge: "continue",
    secondaryActions: [],
    freshness: "cached",
    sourceAvailability: { kind: "online-ready", defaultChoice: "online" },
    updatedAt: sourceEntry.updatedAt,
    ...patch,
  } satisfies ContinuationHubRow;
}

test("buildContinueHubView groups rows and labels ask-inline source choice", () => {
  const localTarget = row({ id: "local", group: "offline-ready" }).target;
  const view = buildContinueHubView({
    selectedIndex: 0,
    maxVisible: 10,
    rows: [
      row({
        id: "local",
        group: "offline-ready",
        badge: "downloaded",
        sourceAvailability: {
          kind: "both-ready",
          defaultChoice: "ask-inline",
          localAction: { kind: "play-local", target: localTarget, jobId: "job-1" },
          onlineAction: { kind: "select-online", target: localTarget },
        },
        primaryAction: {
          kind: "ask-inline",
          target: localTarget,
          localAction: { kind: "play-local", target: localTarget, jobId: "job-1" },
          onlineAction: { kind: "select-online", target: localTarget },
        },
      }),
      row({ id: "new", group: "new-episodes", badge: "1 new" }),
      row({ id: "tracked", group: "up-to-date", badge: "tracked" }),
    ],
  });

  expect(view.items.map((item) => (item.kind === "section" ? item.label : item.row.title))).toEqual(
    ["Offline ready", "local", "New episodes", "new", "Up to date / tracked", "tracked"],
  );
  expect(view.flatRows[0]?.actionLabel).toBe("choose source");
  expect(view.flatRows[0]?.sourceLabel).toBe("local + stream");
});
