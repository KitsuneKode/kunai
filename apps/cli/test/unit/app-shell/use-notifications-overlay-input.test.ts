import { describe, expect, test } from "bun:test";

import { buildNotificationsView, type NotificationsView } from "@/app-shell/notifications-view";
import {
  createNotificationsOverlayState,
  handleNotificationsOverlayInput,
  type NotificationsOverlayState,
} from "@/app-shell/use-notifications-overlay-input";
import type { NotificationRecord } from "@kunai/storage";

const rec = (dedupKey: string, updatedAt: string, over: Partial<NotificationRecord> = {}) => ({
  id: dedupKey,
  dedupKey,
  kind: "new-episode",
  title: `T ${dedupKey}`,
  body: "b",
  actionJson: JSON.stringify(["queue-next", "dismiss"]),
  createdAt: updatedAt,
  updatedAt,
  ...over,
});

const fiveRecords = () => [
  rec("k0", "2026-07-16T05:00:00.000Z"),
  rec("k1", "2026-07-16T04:00:00.000Z"),
  rec("k2", "2026-07-16T03:00:00.000Z"),
  rec("k3", "2026-07-16T02:00:00.000Z"),
  rec("k4", "2026-07-16T01:00:00.000Z"),
];

type Harness = {
  state: NotificationsOverlayState;
  view: NotificationsView;
  calls: string[];
  selectedIndexResets: number;
  press: (input: string, key?: Record<string, boolean>) => string;
};

function harness(options?: {
  records?: readonly NotificationRecord[];
  state?: NotificationsOverlayState;
  pageSize?: number;
  /** How many notices markAllRead reports having marked. */
  unreadCount?: number;
}): Harness {
  const records = options?.records ?? fiveRecords();
  const pageSize = options?.pageSize ?? 2;
  const calls: string[] = [];
  const container = {
    notificationService: {
      markAllRead: () => {
        calls.push("markAllRead");
        return options?.unreadCount ?? 3;
      },
      markRead: (key: string) => calls.push(`markRead:${key}`),
      archive: (key: string) => calls.push(`archive:${key}`),
      delete: (key: string) => calls.push(`delete:${key}`),
      clearArchived: () => {
        calls.push("clearArchived");
        return 1;
      },
    },
  } as never;

  const h: Harness = {
    state: options?.state ?? createNotificationsOverlayState(),
    view: undefined as unknown as NotificationsView,
    calls,
    selectedIndexResets: 0,
    press: (input, key = {}) => {
      h.view = buildNotificationsView({
        records,
        tab: h.state.tab,
        sortMode: h.state.sortByTab[h.state.tab],
        page: h.state.page,
        pageSize,
        selectedDedupKey: h.state.selectedDedupKey,
        now: "2026-07-16T12:00:00.000Z",
      });
      return handleNotificationsOverlayInput(input, key, {
        container,
        state: h.state,
        view: h.view,
        setState: (update) => {
          h.state = update(h.state);
        },
        onRedraw: () => {},
        setOverlayStatus: (status) => calls.push(`status:${status}`),
        setNotificationActionDedupKey: (key2) => calls.push(`openActions:${key2}`),
        setFilterQuery: () => {},
        setSelectedIndex: () => {
          h.selectedIndexResets += 1;
        },
      });
    },
  };
  return h;
}

describe("createNotificationsOverlayState", () => {
  test("starts on Active with per-tab default sorts", () => {
    expect(createNotificationsOverlayState()).toEqual({
      tab: "active",
      page: 0,
      sortByTab: { active: "attention", archive: "newest" },
      selectedDedupKey: null,
    });
  });
});

describe("handleNotificationsOverlayInput", () => {
  test("Active cycles attention → newest → type → attention and resets page/selection", () => {
    const h = harness({
      state: {
        tab: "active",
        page: 1,
        sortByTab: { active: "attention", archive: "newest" },
        selectedDedupKey: "k2",
      },
    });

    expect(h.press("s")).toBe("handled");
    expect(h.state).toEqual({
      tab: "active",
      page: 0,
      sortByTab: { active: "newest", archive: "newest" },
      selectedDedupKey: null,
    });

    h.press("s");
    expect(h.state.sortByTab).toEqual({ active: "type", archive: "newest" });
    h.press("s");
    expect(h.state.sortByTab).toEqual({ active: "attention", archive: "newest" });
  });

  test("Archive cycles newest ↔ type", () => {
    const h = harness({
      state: {
        tab: "archive",
        page: 0,
        sortByTab: { active: "type", archive: "newest" },
        selectedDedupKey: null,
      },
    });

    h.press("s");
    expect(h.state).toEqual({
      tab: "archive",
      page: 0,
      sortByTab: { active: "type", archive: "type" },
      selectedDedupKey: null,
    });
    h.press("s");
    expect(h.state.sortByTab).toEqual({ active: "type", archive: "newest" });
  });

  test("tab switch resets page/selection and retains the destination tab's prior sort", () => {
    const h = harness({
      state: {
        tab: "active",
        page: 2,
        sortByTab: { active: "type", archive: "type" },
        selectedDedupKey: "k3",
      },
    });

    h.press("", { tab: true });
    expect(h.state).toEqual({
      tab: "archive",
      page: 0,
      sortByTab: { active: "type", archive: "type" },
      selectedDedupKey: null,
    });

    h.press("", { tab: true });
    expect(h.state.tab).toBe("active");
    expect(h.state.sortByTab).toEqual({ active: "type", archive: "type" });
  });

  test("page changes reset selection and clamp through view.totalPages", () => {
    const h = harness({
      state: {
        tab: "active",
        page: 0,
        sortByTab: { active: "newest", archive: "newest" },
        selectedDedupKey: "k0",
      },
    });

    h.press("]");
    expect(h.state.page).toBe(1);
    expect(h.state.selectedDedupKey).toBeNull();

    h.press("]");
    h.press("]");
    // 5 records at pageSize 2 → 3 pages; stays clamped on the last page.
    expect(h.state.page).toBe(2);

    h.press("[");
    expect(h.state.page).toBe(1);
    h.press("[");
    h.press("[");
    expect(h.state.page).toBe(0);
  });

  test("up/down stores a visible row identity without changing pages", () => {
    const h = harness({
      state: {
        tab: "active",
        page: 0,
        sortByTab: { active: "newest", archive: "newest" },
        selectedDedupKey: null,
      },
    });

    h.press("", { downArrow: true });
    expect(h.state.selectedDedupKey).toBe("k1");
    h.press("", { downArrow: true });
    expect(h.state.selectedDedupKey).toBe("k1");
    expect(h.state.page).toBe(0);

    h.press("", { upArrow: true });
    expect(h.state.selectedDedupKey).toBe("k0");
    h.press("", { upArrow: true });
    expect(h.state.selectedDedupKey).toBe("k0");
    expect(h.state.page).toBe(0);
  });

  test("r preserves the selected identity before marking read", () => {
    const h = harness();

    h.press("r");
    expect(h.calls).toEqual(["markRead:k0"]);
    expect(h.state.selectedDedupKey).toBe("k0");
  });

  test("A preserves the selected identity before marking all read", () => {
    const h = harness({
      state: {
        tab: "active",
        page: 0,
        sortByTab: { active: "attention", archive: "newest" },
        selectedDedupKey: "k1",
      },
    });

    h.press("A");
    expect(h.calls).toEqual(["markAllRead", "status:Marked 3 as read"]);
    expect(h.state.selectedDedupKey).toBe("k1");
  });

  test("A reports that nothing changed when no notice was unread", () => {
    // Marking read only clears a dot. With an already-read inbox the keypress
    // would otherwise look dropped.
    const h = harness({ unreadCount: 0 });

    h.press("A");
    expect(h.calls).toEqual(["markAllRead", "status:Nothing unread to mark"]);
  });

  test("x selects the nearest surviving row before archiving", () => {
    const h = harness({
      state: {
        tab: "active",
        page: 0,
        sortByTab: { active: "newest", archive: "newest" },
        selectedDedupKey: "k1",
      },
    });

    h.press("x");
    expect(h.calls).toEqual(["archive:k1"]);
    expect(h.state.selectedDedupKey).toBe("k2");
  });

  test("d selects the previous row when deleting the final row", () => {
    const h = harness({
      state: {
        tab: "active",
        page: 0,
        sortByTab: { active: "newest", archive: "newest" },
        selectedDedupKey: "k4",
      },
    });

    h.press("d");
    expect(h.calls).toEqual(["delete:k4", "status:Notification deleted"]);
    expect(h.state.selectedDedupKey).toBe("k3");
  });

  test("C resets page and selected identity", () => {
    const h = harness({
      state: {
        tab: "archive",
        page: 1,
        sortByTab: { active: "attention", archive: "newest" },
        selectedDedupKey: "k2",
      },
    });

    h.press("C");
    expect(h.calls[0]).toBe("clearArchived");
    expect(h.state.page).toBe(0);
    expect(h.state.selectedDedupKey).toBeNull();
  });

  test("a opens the action picker for the selected dedupKey without clearing identity", () => {
    const h = harness({
      state: {
        tab: "active",
        page: 0,
        sortByTab: { active: "newest", archive: "newest" },
        selectedDedupKey: "k2",
      },
    });

    h.press("a");
    expect(h.calls).toEqual(["openActions:k2"]);
    expect(h.state.selectedDedupKey).toBe("k2");
    expect(h.selectedIndexResets).toBe(1);
  });

  test("unknown keys fall through", () => {
    const h = harness();
    expect(h.press("z")).toBe("not-handled");
  });
});
