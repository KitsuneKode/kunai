import { describe, expect, it } from "bun:test";

import { buildNotificationsView } from "@/app-shell/notifications-view";
import type { NotificationRecord } from "@kunai/storage";

const rec = (over: Partial<NotificationRecord>): NotificationRecord => ({
  id: over.dedupKey ?? "id",
  dedupKey: "k",
  kind: "new-episode",
  title: "Frieren S1E13 available",
  body: "available on allanime",
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
  ...over,
});

describe("buildNotificationsView", () => {
  it("marks unread rows and picks a poster for new-episode", () => {
    const view = buildNotificationsView({
      records: [rec({ dedupKey: "a", kind: "new-episode", readAt: undefined })],
      tab: "active",
      page: 0,
      pageSize: 10,
      now: "2026-06-14T02:00:00.000Z",
    });
    expect(view.rows[0]?.unread).toBe(true);
    expect(view.rows[0]?.usePoster).toBe(true);
    expect(view.rows[0]?.relativeTime).toBe("2h");
  });

  it("uses a glyph for non-episode kinds and marks read rows", () => {
    const view = buildNotificationsView({
      records: [rec({ dedupKey: "b", kind: "app-update", readAt: "2026-06-14T01:00:00.000Z" })],
      tab: "active",
      page: 0,
      pageSize: 10,
      now: "2026-06-14T02:00:00.000Z",
    });
    expect(view.rows[0]?.unread).toBe(false);
    expect(view.rows[0]?.usePoster).toBe(false);
    expect(view.rows[0]?.glyph).toBe("⬆");
  });

  it("paginates and reports total pages", () => {
    const records = Array.from({ length: 5 }, (_, i) => rec({ dedupKey: `k${i}` }));
    const view = buildNotificationsView({
      records,
      tab: "active",
      page: 1,
      pageSize: 2,
      now: "2026-06-14T02:00:00.000Z",
    });
    expect(view.rows).toHaveLength(2);
    expect(view.totalPages).toBe(3);
    expect(view.page).toBe(1);
  });

  it("reports empty", () => {
    const view = buildNotificationsView({
      records: [],
      tab: "active",
      page: 0,
      pageSize: 10,
      now: "2026-06-14T02:00:00.000Z",
    });
    expect(view.isEmpty).toBe(true);
  });
});
