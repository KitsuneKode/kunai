import { describe, expect, it } from "bun:test";

import { NotificationsShell } from "@/app-shell/notifications-shell";
import { buildNotificationsView } from "@/app-shell/notifications-view";
import type { NotificationRecord } from "@kunai/storage";
import React from "react";

import { captureFrame } from "../../harness/render-capture";

const records: NotificationRecord[] = [
  {
    id: "1",
    dedupKey: "a",
    kind: "new-episode",
    title: "Frieren S1E13 available",
    body: "on allanime",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
  },
  {
    id: "2",
    dedupKey: "b",
    kind: "app-update",
    title: "Update available 1.3.0",
    body: "you are on 1.2.0",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    readAt: "2026-06-14T01:00:00.000Z",
  },
];

describe("NotificationsShell", () => {
  it("renders titles, the active tab and unread count", () => {
    const view = buildNotificationsView({
      records,
      tab: "active",
      page: 0,
      pageSize: 10,
      now: "2026-06-14T02:00:00.000Z",
    });
    const frame = captureFrame(
      <NotificationsShell view={view} columns={120} selectedIndex={0} unreadCount={1} />,
      { columns: 120 },
    );
    expect(frame).toContain("Frieren S1E13 available");
    expect(frame).toContain("Update available 1.3.0");
    expect(frame).toContain("Active");
  });

  it("renders an empty state", () => {
    const view = buildNotificationsView({
      records: [],
      tab: "active",
      page: 0,
      pageSize: 10,
      now: "2026-06-14T02:00:00.000Z",
    });
    const frame = captureFrame(
      <NotificationsShell view={view} columns={120} selectedIndex={0} unreadCount={0} />,
      { columns: 120 },
    );
    expect(frame).toContain("No notifications");
  });
});
