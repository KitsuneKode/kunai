import { afterEach, expect, test } from "bun:test";

import type { NotificationSignal } from "@/services/notifications/NotificationEngine";
import { NotificationService } from "@/services/notifications/NotificationService";
import { NotificationRepository } from "@kunai/storage";
import { createTempStoreRegistry } from "@kunai/storage/testing";

const stores = createTempStoreRegistry();
afterEach(() => stores.cleanup());

test.each(["anime", "series"])(
  "clearing archived %s notifications suppresses repeated signals, not newer episodes or active notices",
  (mediaKind) => {
    const repository = new NotificationRepository(stores.store("notification-archive", "data"));
    const service = new NotificationService({
      repo: repository,
      getMutedTitleIds: () => new Set<string>(),
    });
    const recordedAt = new Date().toISOString();
    const archivedAt = new Date(Date.parse(recordedAt) + 1).toISOString();
    const refreshedAt = new Date(Date.parse(archivedAt) + 1).toISOString();
    const signal: NotificationSignal = {
      type: "new-playable-episode",
      titleId: "notification-title",
      title: "Notification title",
      mediaKind,
      season: 1,
      episode: 2,
      providerId: "test-provider",
      availableAt: recordedAt,
    };
    const activeSignal: NotificationSignal = { ...signal, titleId: "active-title" };
    service.recordSignals([signal, activeSignal], recordedAt);
    const archived = service
      .listActive()
      .find((row) => row.itemJson?.includes("notification-title"));
    const active = service.listActive().find((row) => row.itemJson?.includes("active-title"));
    if (!archived || !active) throw new Error("Missing notification fixture");
    service.markRead(active.dedupKey, recordedAt);
    const activeBefore = repository.getByDedupKey(active.dedupKey);
    service.archive(archived.dedupKey, archivedAt);

    expect(service.clearArchived()).toBe(1);
    expect(service.listArchived()).toEqual([]);
    expect(repository.getByDedupKey(active.dedupKey)).toEqual(activeBefore);
    expect(service.clearArchived()).toBe(0);

    service.recordSignals([signal], refreshedAt);
    expect(repository.getByDedupKey(archived.dedupKey)).toBeUndefined();
    expect(service.listActive().map((row) => row.dedupKey)).toEqual([active.dedupKey]);
    expect(repository.listSuppressedKeys()).toEqual(new Set([archived.dedupKey]));

    service.recordSignals([{ ...signal, episode: 3 }], refreshedAt);
    expect(service.countActive()).toBe(2);
    expect(service.countUnread()).toBe(1);
    expect(repository.getByDedupKey(active.dedupKey)).toEqual(activeBefore);
  },
);
