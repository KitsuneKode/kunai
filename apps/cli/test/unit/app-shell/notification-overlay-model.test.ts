import { expect, test } from "bun:test";

import {
  buildNotificationActionOptions,
  buildNotificationPickerOptions,
  getNotificationPrimaryAction,
} from "@/app-shell/notification-overlay-model";
import type { NotificationRecord } from "@kunai/storage";

const base: NotificationRecord = {
  id: "notice-1",
  dedupKey: "queue-recoverable:old-session",
  kind: "queue-recovery",
  title: "Previous queue available",
  body: "2 queued items can be restored",
  actionJson: JSON.stringify(["restore-queue", "dismiss"]),
  createdAt: "2026-05-17T00:00:00.000Z",
  updatedAt: "2026-05-17T00:00:00.000Z",
};

test("notification picker exposes actionable queue recovery rows", () => {
  const options = buildNotificationPickerOptions([base]);

  expect(options).toEqual([
    {
      value: "queue-recoverable:old-session",
      label: "Previous queue available",
      detail: "2 queued items can be restored",
      tone: "warning",
      badge: "enter: restore  ·  a: all actions  ·  x: dismiss",
    },
  ]);
});

test("primary action prefers the first actionable notification action", () => {
  expect(getNotificationPrimaryAction(base)).toBe("restore-queue");
  expect(
    getNotificationPrimaryAction({
      ...base,
      kind: "new-episode",
      actionJson: JSON.stringify(["queue-next", "dismiss"]),
    }),
  ).toBe("queue-next");
  expect(getNotificationPrimaryAction({ ...base, actionJson: undefined })).toBe("dismiss");
});

test("notification action menu exposes explicit safe row actions", () => {
  expect(buildNotificationActionOptions(base)).toEqual([
    {
      value: "restore-queue",
      label: "Restore queue",
      detail: "Restore pending items into the current queue without autoplay",
      tone: "warning",
    },
    {
      value: "dismiss",
      label: "Dismiss",
      detail: "Hide this notice",
      tone: "neutral",
    },
  ]);
});

test("notification action menu exposes actions the root overlay can execute", () => {
  const notice = {
    ...base,
    kind: "new-episode",
    actionJson: JSON.stringify([
      "download",
      "queue-end",
      "follow",
      "play-now",
      "open-details",
      "dismiss",
    ]),
  };

  expect(getNotificationPrimaryAction(notice)).toBe("download");
  expect(buildNotificationActionOptions(notice).map((option) => option.value)).toEqual([
    "download",
    "queue-end",
    "follow",
    "play-now",
    "open-details",
    "dismiss",
  ]);
});
