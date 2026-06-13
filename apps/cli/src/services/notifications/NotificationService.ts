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

  listActive(limit = 50): NotificationRecord[] {
    return this.deps.repo.listActive(limit);
  }

  dismiss(dedupKey: string, now = new Date().toISOString()): void {
    this.deps.repo.dismissByDedupKey(dedupKey, now);
  }
}

function defaultNotificationActionIds(kind: string): readonly string[] {
  if (kind === "queue-recovery") return ["restore-queue", "dismiss"];
  return ["queue-next", "queue-end", "dismiss"];
}
