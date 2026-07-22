import { expect, test } from "bun:test";

import {
  buildNotificationActionOptions,
  buildNotificationPickerOptions,
  getExecutableNotificationActions,
  getNotificationActionPresentation,
  getNotificationPrimaryAction,
  getNotificationTone,
  getSelectedNotificationActionId,
  selectNotificationPickerOptions,
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

test("notification action selection requires a visible explicit option", () => {
  const options = buildNotificationActionOptions(base);

  expect(getSelectedNotificationActionId(options, 0)).toBe("restore-queue");
  expect(getSelectedNotificationActionId([], 0)).toBeNull();
  expect(getSelectedNotificationActionId(options, options.length)).toBeNull();
});

test("notification picker mode exposes one option collection to render and navigation", () => {
  const inbox = ["notice"];
  const actions = ["queue-next"];
  const confirmation = ["confirm", "cancel"];

  expect(
    selectNotificationPickerOptions({
      confirmationActive: true,
      actionPickerActive: false,
      inbox,
      actions,
      confirmation,
    }),
  ).toBe(confirmation);
  expect(
    selectNotificationPickerOptions({
      confirmationActive: false,
      actionPickerActive: true,
      inbox,
      actions,
      confirmation,
    }),
  ).toBe(actions);
  expect(
    selectNotificationPickerOptions({
      confirmationActive: false,
      actionPickerActive: false,
      inbox,
      actions,
      confirmation,
    }),
  ).toBe(inbox);
});

test("retry-download and update-app are executable primary actions with copy", () => {
  const downloadFailed = {
    ...base,
    kind: "download-failed",
    actionJson: JSON.stringify(["retry-download", "dismiss"]),
  };
  const appUpdate = {
    ...base,
    kind: "app-update",
    dedupKey: "app-update:1.4.0",
    actionJson: JSON.stringify(["update-app", "dismiss"]),
  };

  expect(getNotificationPrimaryAction(downloadFailed)).toBe("retry-download");
  expect(getNotificationPrimaryAction(appUpdate)).toBe("update-app");
  expect(getNotificationActionPresentation("retry-download").label).toBe("Retry download");
  // Not "Open release page": update routing became install-method aware, so
  // this installs in place on native installs and only falls back to the web.
  expect(getNotificationActionPresentation("update-app").label).toBe("Update Kunai");
  expect(getNotificationActionPresentation("retry-download").tone).toBe("warning");
  expect(getNotificationActionPresentation("retry-download").detail).toBe(
    "Retry this item through the standard download action",
  );
  expect(getNotificationActionPresentation("update-app").detail).toBe(
    "Install the new version, or show how to update if a package manager owns this install",
  );
});

test("malformed stored actions collapse to a dismiss-only notice", () => {
  const malformedActions = { ...base, actionJson: "{not json" };

  expect(getExecutableNotificationActions(malformedActions)).toEqual([]);
  expect(getNotificationPrimaryAction(malformedActions)).toBe("dismiss");
});

test("unknown kinds keep valid stored actions and neutral presentation", () => {
  const futureKind = {
    ...base,
    kind: "future-kind",
    actionJson: JSON.stringify(["queue-end", "dismiss", "not-a-real-action"]),
  };

  expect(getExecutableNotificationActions(futureKind)).toEqual(["queue-end", "dismiss"]);
  expect(getNotificationTone("future-kind")).toBe("neutral");
  expect(getNotificationActionPresentation("queue-end").tone).toBe("neutral");
});

test("kind tones map attention semantics to shell status tones", () => {
  expect(getNotificationTone("queue-recovery")).toBe("warning");
  expect(getNotificationTone("download-failed")).toBe("error");
  expect(getNotificationTone("new-episode")).toBe("success");
  expect(getNotificationTone("download-complete")).toBe("success");
  expect(getNotificationTone("app-update")).toBe("info");
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
