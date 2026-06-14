import type { NotificationRepository, NotificationRecord } from "@kunai/storage";

import { deriveNotifications, type NotificationSignal } from "./NotificationEngine";

export interface NotificationServiceDeps {
  readonly repo: NotificationRepository;
  readonly getMutedTitleIds: () => ReadonlySet<string>;
}

export class NotificationService {
  constructor(private readonly deps: NotificationServiceDeps) {}

  recordSignals(signals: readonly NotificationSignal[], now = new Date().toISOString()): void {
    const notifications = deriveNotifications({
      signals,
      mutedTitleIds: this.deps.getMutedTitleIds(),
      now,
    });

    for (const notification of notifications) {
      this.deps.repo.upsert({
        dedupKey: notification.dedupKey,
        kind: notification.kind,
        title: notification.title,
        body: notification.body,
        itemJson: notification.item
          ? JSON.stringify(notification.item)
          : notification.queueSessionId
            ? JSON.stringify({ queueSessionId: notification.queueSessionId })
            : undefined,
        actionJson: JSON.stringify(defaultNotificationActionIds(notification.kind)),
        createdAt: notification.createdAt,
        updatedAt: notification.updatedAt,
      });
    }
  }

  listActive(limit = 50, offset = 0): NotificationRecord[] {
    return this.deps.repo.listActive(limit, offset);
  }

  listArchived(limit = 50, offset = 0): NotificationRecord[] {
    return this.deps.repo.listArchived(limit, offset);
  }

  countUnread(): number {
    return this.deps.repo.countUnread();
  }

  countActive(): number {
    return this.deps.repo.countActive();
  }

  markRead(dedupKey: string, now = new Date().toISOString()): void {
    this.deps.repo.markRead(dedupKey, now);
  }

  markAllRead(now = new Date().toISOString()): void {
    this.deps.repo.markAllRead(now);
  }

  archive(dedupKey: string, now = new Date().toISOString()): void {
    this.deps.repo.archive(dedupKey, now);
  }

  dismiss(dedupKey: string, now = new Date().toISOString()): void {
    this.deps.repo.dismissByDedupKey(dedupKey, now);
  }

  delete(dedupKey: string): void {
    this.deps.repo.deleteByDedupKey(dedupKey);
  }

  clearArchived(): number {
    return this.deps.repo.clearArchived();
  }
}

function defaultNotificationActionIds(kind: string): readonly string[] {
  if (kind === "queue-recovery") return ["restore-queue", "dismiss"];
  if (kind === "download-failed") return ["retry-download", "dismiss"];
  if (kind === "app-update") return ["update-app", "dismiss"];
  return ["queue-next", "queue-end", "dismiss"];
}
