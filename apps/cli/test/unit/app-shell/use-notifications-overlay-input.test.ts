import { describe, expect, test } from "bun:test";

import { handleNotificationsOverlayInput } from "@/app-shell/use-notifications-overlay-input";

describe("handleNotificationsOverlayInput", () => {
  test("page-up/down chords paginate notifications", () => {
    let page = 2;
    const result = handleNotificationsOverlayInput(
      "[",
      {},
      {
        container: {
          notificationService: {
            markAllRead: () => {},
            markRead: () => {},
            archive: () => {},
            delete: () => {},
            clearArchived: () => 0,
          },
        } as never,
        notifRow: undefined,
        totalPages: 4,
        onRedraw: () => {},
        setNotifTab: () => {},
        setNotifPage: (update) => {
          page = update(page);
        },
        setSelectedIndex: () => {},
        setNotifTick: () => {},
        setOverlayStatus: () => {},
        setNotificationActionDedupKey: () => {},
        setFilterQuery: () => {},
      },
    );

    expect(result).toBe("handled");
    expect(page).toBe(1);
  });
});
