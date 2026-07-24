import type { LineEditorKey } from "@/app-shell/line-editor";
import type { Container } from "@/container";
import type { NotificationActionId } from "@/services/notifications/NotificationActionRouter";

import {
  cycleNotificationsSortMode,
  nearestNotificationDedupKey,
  type NotificationsSortMode,
  type NotificationsTab,
  type NotificationsView,
} from "./notifications-view";

export type NotificationsSortByTab = Readonly<{
  active: NotificationsSortMode;
  archive: Exclude<NotificationsSortMode, "attention">;
}>;

/**
 * Session-local inbox navigation state. It lives in `RootOverlayShell` for the
 * overlay lifetime only: each tab retains its selected sort until the overlay
 * unmounts, and selection is identity-based (`dedupKey`) so re-sorting or
 * mutation never silently retargets a different notice.
 */
export type NotificationsOverlayState = {
  readonly tab: NotificationsTab;
  readonly page: number;
  readonly sortByTab: NotificationsSortByTab;
  readonly selectedDedupKey: string | null;
};

export function createNotificationsOverlayState(): NotificationsOverlayState {
  return {
    tab: "active",
    page: 0,
    sortByTab: { active: "attention", archive: "newest" },
    selectedDedupKey: null,
  };
}

export type NotificationsOverlayInputContext = {
  readonly container: Container;
  readonly state: NotificationsOverlayState;
  readonly view: NotificationsView;
  readonly setState: (
    update: (state: NotificationsOverlayState) => NotificationsOverlayState,
  ) => void;
  readonly onRedraw: () => void;
  readonly setOverlayStatus: (status: string) => void;
  readonly setNotificationActionDedupKey: (key: string) => void;
  readonly setFilterQuery: (query: string) => void;
  /** Generic picker index shared with the nested action/confirm pickers. */
  readonly setSelectedIndex: (update: (current: number) => number) => void;
};

export type NotificationsOverlayInputResult = "handled" | "not-handled";

/**
 * Top-level Notifications inbox key map. Tab/sort/page/selection are pure state
 * transitions against the current `NotificationsView`; lifecycle keys compute
 * their next selection (identity preservation or nearest survivor) BEFORE
 * mutating storage so the refreshed view lands on the intended row.
 */
export function handleNotificationsOverlayInput(
  input: string,
  key: LineEditorKey,
  ctx: NotificationsOverlayInputContext,
): NotificationsOverlayInputResult {
  const selectedKey = ctx.view.selectedRow?.dedupKey ?? null;

  if (key.tab) {
    ctx.setState((state) => ({
      ...state,
      tab: state.tab === "active" ? "archive" : "active",
      page: 0,
      selectedDedupKey: null,
    }));
    return "handled";
  }
  if (input === "s") {
    ctx.setState((state) => {
      const current = state.sortByTab[state.tab];
      const next = cycleNotificationsSortMode(state.tab, current);
      return {
        ...state,
        page: 0,
        selectedDedupKey: null,
        sortByTab: { ...state.sortByTab, [state.tab]: next },
      } as NotificationsOverlayState;
    });
    return "handled";
  }
  if (input === "[") {
    const page = Math.max(0, ctx.view.page - 1);
    ctx.setState((state) => ({ ...state, page, selectedDedupKey: null }));
    return "handled";
  }
  if (input === "]") {
    const page = Math.min(ctx.view.totalPages - 1, ctx.view.page + 1);
    ctx.setState((state) => ({ ...state, page, selectedDedupKey: null }));
    return "handled";
  }
  if (key.upArrow || key.downArrow) {
    const visibleRows = ctx.view.rows;
    if (visibleRows.length === 0) return "handled";
    const currentIndex = Math.max(0, ctx.view.selectedIndex);
    const nextIndex = key.downArrow
      ? Math.min(visibleRows.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1);
    const nextKey = visibleRows[nextIndex]?.dedupKey ?? null;
    ctx.setState((state) => ({ ...state, selectedDedupKey: nextKey }));
    return "handled";
  }
  if (input === "A") {
    ctx.setState((state) => ({ ...state, selectedDedupKey: selectedKey }));
    const marked = ctx.container.notificationService.markAllRead();
    // Marking read changes only the unread dot, which is easy to miss on a long
    // list — and when nothing was unread it changes nothing at all. Say which
    // happened rather than leaving the keypress looking dropped.
    ctx.setOverlayStatus(marked > 0 ? `Marked ${marked} as read` : "Nothing unread to mark");
    return "handled";
  }
  if (input === "r" && selectedKey) {
    ctx.setState((state) => ({ ...state, selectedDedupKey: selectedKey }));
    ctx.container.notificationService.markRead(selectedKey);
    return "handled";
  }
  if (input.toLowerCase() === "x" && selectedKey) {
    const nearest = nearestNotificationDedupKey(ctx.view.orderedDedupKeys, selectedKey);
    ctx.setState((state) => ({ ...state, selectedDedupKey: nearest }));
    ctx.container.notificationService.archive(selectedKey);
    return "handled";
  }
  if (input === "d" && selectedKey) {
    const nearest = nearestNotificationDedupKey(ctx.view.orderedDedupKeys, selectedKey);
    ctx.setState((state) => ({ ...state, selectedDedupKey: nearest }));
    ctx.container.notificationService.delete(selectedKey);
    ctx.setOverlayStatus("Notification deleted");
    return "handled";
  }
  if (input === "C") {
    const removed = ctx.container.notificationService.clearArchived();
    ctx.setState((state) => ({ ...state, page: 0, selectedDedupKey: null }));
    ctx.setOverlayStatus(removed > 0 ? `Cleared ${removed} archived` : "Nothing to clear");
    return "handled";
  }
  if (input.toLowerCase() === "a" && selectedKey) {
    // Pin identity before entering the nested action picker: the child picker
    // resets the generic index, and Esc must restore this exact top-level row.
    ctx.setState((state) => ({ ...state, selectedDedupKey: selectedKey }));
    ctx.setNotificationActionDedupKey(selectedKey);
    ctx.setFilterQuery("");
    ctx.setSelectedIndex(() => 0);
    return "handled";
  }

  return "not-handled";
}

/** Type-only export for action routing call sites. */
export type { NotificationActionId };
