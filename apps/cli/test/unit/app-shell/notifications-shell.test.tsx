import { describe, expect, it } from "bun:test";

import { NotificationsShell } from "@/app-shell/notifications-shell";
import {
  buildNotificationsView,
  type BuildNotificationsViewInput,
} from "@/app-shell/notifications-view";
import type { NotificationRecord } from "@kunai/storage";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

const rec = (over: Partial<NotificationRecord>): NotificationRecord => ({
  id: over.dedupKey ?? "id",
  dedupKey: "k",
  kind: "new-episode",
  title: "Frieren S1E13 available",
  body: "available on allanime",
  actionJson: JSON.stringify(["queue-next", "queue-end", "dismiss"]),
  createdAt: "2026-07-16T10:00:00.000Z",
  updatedAt: "2026-07-16T10:00:00.000Z",
  ...over,
});

const mediaRecord = rec({
  dedupKey: "a",
  itemJson: JSON.stringify({
    mediaKind: "anime",
    titleId: "tmdb:1",
    title: "Frieren",
    season: 1,
    episode: 6,
    providerHints: [{ providerId: "allanime" }],
  }),
});

const view = (over: Partial<BuildNotificationsViewInput>) =>
  buildNotificationsView({
    records: [mediaRecord],
    tab: "active",
    sortMode: "attention",
    page: 0,
    pageSize: 6,
    selectedDedupKey: null,
    now: "2026-07-16T12:00:00.000Z",
    ...over,
  });

function frameAt(columns: number, v = view({}), unreadCount = 1): string {
  return captureFrame(
    <NotificationsShell
      view={v}
      columns={columns}
      selectedIndex={v.selectedIndex}
      unreadCount={unreadCount}
    />,
    { columns: columns + 4 },
  );
}

describe("NotificationsShell", () => {
  it("renders the selected-notice companion rail at 140 columns", () => {
    const frame = frameAt(140);

    // Dense row: title, primary action label, recency.
    expect(frame).toContain("Frieren S1E13 available");
    expect(frame).toContain("Queue next");
    expect(frame).toContain("2h");
    // Context strip: tab, sort, unread count.
    expect(frame).toContain("Active");
    expect(frame).toContain("Needs attention");
    expect(frame).toContain("1 unread");
    // Rail: body, read state, primary + secondary actions, lifecycle hints.
    expect(frame).toContain("available on allanime");
    expect(frame).toContain("Unread");
    expect(frame).toContain("↵ Queue next");
    expect(frame).toContain("· Queue at end");
    expect(frame).toContain("r mark read");
    expect(frame).toContain("x archive");
    expect(frame).toContain("d delete");
    // Media evidence facts.
    expect(frame).toContain("S01E06");
    expect(frame).toContain("allanime");
  });

  it("collapses the rail at 100 and 72 columns while keeping rows and labels", () => {
    for (const columns of [100, 72]) {
      const frame = frameAt(columns);

      expect(frame).toContain("Frieren S1E13 available");
      expect(frame).toContain("Queue next");
      expect(frame).toContain("Needs attention");
      // Rail-only evidence is absent.
      expect(frame).not.toContain("mark read");
      expect(frame).not.toContain("S01E06");
      expect(frame).not.toContain("↵ Queue next");
    }
  });

  it("renders a read selected row without the unread badge in the rail", () => {
    const readRecord = rec({
      dedupKey: "b",
      kind: "app-update",
      title: "Update available 1.4.0",
      body: "you are on 1.3.0",
      actionJson: JSON.stringify(["update-app", "dismiss"]),
      readAt: "2026-07-16T11:00:00.000Z",
    });
    const frame = frameAt(140, view({ records: [readRecord] }), 0);

    expect(frame).toContain("Update available 1.4.0");
    expect(frame).toContain("Read");
    expect(frame).toContain("↵ Update Kunai");
    expect(frame).not.toContain("Unread");
  });

  it("renders Archive with archive lifecycle hints and tab label", () => {
    const archived = rec({ dedupKey: "c", archivedAt: "2026-07-16T11:00:00.000Z" });
    const frame = frameAt(
      140,
      view({ records: [archived], tab: "archive", sortMode: "newest" }),
      0,
    );

    expect(frame).toContain("Archive");
    expect(frame).toContain("Newest");
    expect(frame).toContain("C clear archive");
    expect(frame).not.toContain("x archive");
  });

  it("uses the exact Active and Archive empty copy", () => {
    const activeEmpty = frameAt(100, view({ records: [] }), 0);
    expect(activeEmpty).toContain("You're all caught up.");
    expect(activeEmpty).not.toContain("No notifications");

    const archiveEmpty = frameAt(100, view({ records: [], tab: "archive", sortMode: "newest" }), 0);
    expect(archiveEmpty).toContain("No archived notifications.");
  });

  it("shows compact pagination for multiple pages", () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      rec({ dedupKey: `k${i}`, updatedAt: `2026-07-16T0${5 - i}:00:00.000Z` }),
    );
    const frame = frameAt(100, view({ records, sortMode: "newest", pageSize: 2, page: 1 }));

    expect(frame).toContain("page 2/3");
  });

  it("truncates long titles inside the row budget", () => {
    const longTitle =
      "An impossibly long notification title that keeps going far beyond any reasonable terminal row width budget";
    const frame = frameAt(72, view({ records: [rec({ dedupKey: "long", title: longTitle })] }));

    expect(frame).not.toContain(longTitle);
    expect(frame).toContain("An impossibly long");
  });

  it("renders unknown kinds and malformed metadata without crashing", () => {
    const records = [
      rec({ dedupKey: "u", kind: "future-kind", title: "Something new" }),
      rec({ dedupKey: "m", itemJson: "{not json", title: "Broken payload" }),
    ];
    const frame = frameAt(140, view({ records, sortMode: "newest" }));

    expect(frame).toContain("Something new");
    expect(frame).toContain("Broken payload");
  });

  it("renders a dismiss-only notice as non-actionable", () => {
    const dismissOnly = rec({
      dedupKey: "d1",
      kind: "download-complete",
      title: "Download finished",
      actionJson: JSON.stringify(["dismiss"]),
    });
    const frame = frameAt(140, view({ records: [dismissOnly] }));

    expect(frame).toContain("Download finished");
    expect(frame).toContain("↵ Dismiss");
  });
});
