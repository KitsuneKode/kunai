import type { NotificationRepository, NotificationRecord } from "@kunai/storage";

import { deriveNotifications, type NotificationSignal } from "./NotificationEngine";

export interface NotificationServiceDeps {
  readonly repo: NotificationRepository;
  readonly getMutedTitleIds: () => ReadonlySet<string>;
}

export class NotificationService {
  constructor(private readonly deps: NotificationServiceDeps) {}

  private readonly listeners = new Set<() => void>();

  /** Subscribe to "the notification set changed" — fires after any mutation. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener();
  }

  recordSignals(signals: readonly NotificationSignal[], now = new Date().toISOString()): void {
    const notifications = deriveNotifications({
      signals,
      mutedTitleIds: this.deps.getMutedTitleIds(),
      now,
    });

    // Never resurrect a notification the user explicitly deleted. Derived signals
    // (new-episode, queue-recovery, …) re-fire every cycle; the suppression tombstone
    // keyed by the stable dedupKey keeps deletes sticky while letting a genuinely new
    // episode/session (different dedupKey) through.
    const suppressed = this.deps.repo.listSuppressedKeys();

    for (const notification of notifications) {
      if (suppressed.has(notification.dedupKey)) continue;
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
    this.emitChange();
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
    this.emitChange();
  }

  markAllRead(now = new Date().toISOString()): void {
    this.deps.repo.markAllRead(now);
    this.emitChange();
  }

  archive(dedupKey: string, now = new Date().toISOString()): void {
    this.deps.repo.archive(dedupKey, now);
    this.emitChange();
  }

  dismiss(dedupKey: string, now = new Date().toISOString()): void {
    this.deps.repo.dismissByDedupKey(dedupKey, now);
    this.emitChange();
  }

  delete(dedupKey: string, now = new Date().toISOString()): void {
    this.deps.repo.deleteByDedupKey(dedupKey, now);
    this.emitChange();
  }

  deleteByKind(kind: string): number {
    const removed = this.deps.repo.deleteByKind(kind);
    this.emitChange();
    return removed;
  }

  clearArchived(): number {
    const removed = this.deps.repo.clearArchived();
    this.emitChange();
    return removed;
  }
}

function defaultNotificationActionIds(kind: string): readonly string[] {
  if (kind === "queue-recovery") return ["restore-queue", "dismiss"];
  if (kind === "download-failed") return ["retry-download", "dismiss"];
  if (kind === "app-update") return ["update-app", "dismiss"];
  return ["queue-next", "queue-end", "dismiss"];
}
