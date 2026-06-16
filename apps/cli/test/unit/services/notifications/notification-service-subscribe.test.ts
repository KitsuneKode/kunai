import { describe, expect, test } from "bun:test";

import { NotificationService } from "@/services/notifications/NotificationService";

function makeService() {
  const repo = {
    upsert: () => {},
    listActive: () => [],
    listArchived: () => [],
    countUnread: () => 0,
    countActive: () => 0,
    markRead: () => {},
    markAllRead: () => {},
    archive: () => {},
    dismissByDedupKey: () => {},
    deleteByDedupKey: () => {},
    deleteByKind: () => 0,
    clearArchived: () => 0,
    listSuppressedKeys: () => new Set<string>(),
  };
  return new NotificationService({
    repo: repo as never,
    getMutedTitleIds: () => new Set<string>(),
  });
}

describe("NotificationService.subscribe", () => {
  test("listener fires on recordSignals and stops after unsubscribe", () => {
    const service = makeService();
    let calls = 0;
    const unsub = service.subscribe(() => {
      calls += 1;
    });
    service.recordSignals([]);
    expect(calls).toBe(1);
    unsub();
    service.recordSignals([]);
    expect(calls).toBe(1);
  });

  test("listener fires on a mutation (delete)", () => {
    const service = makeService();
    let calls = 0;
    service.subscribe(() => {
      calls += 1;
    });
    service.delete("k1");
    expect(calls).toBe(1);
  });
});
