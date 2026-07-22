import type { NotificationRepository, NotificationRecord } from "@kunai/storage";

import {
  deriveNotifications,
  type NotificationDerivationFlags,
  type NotificationSignal,
} from "./NotificationEngine";

export interface NotificationServiceDeps {
  readonly repo: NotificationRepository;
  readonly getMutedTitleIds: () => ReadonlySet<string>;
  /** Feature gates for which notification kinds are derived. Defaults to all on. */
  readonly derivationFlags?: NotificationDerivationFlags;
  readonly sinks?: {
    readonly deliverActive?: (records: readonly NotificationRecord[]) => void;
    readonly dismiss?: (dedupKey: string) => void;
  };
}

export class NotificationService {
  constructor(private readonly deps: NotificationServiceDeps) {}

  private readonly listeners = new Set<() => void>();
  private revision = 0;

  getRevision(): number {
    return this.revision;
  }

  /** Subscribe to "the notification set changed" — fires after any mutation. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    this.revision += 1;
    this.deps.sinks?.deliverActive?.(this.listActive());
    for (const listener of this.listeners) listener();
  }

  recordSignals(signals: readonly NotificationSignal[], now = new Date().toISOString()): void {
    const notifications = deriveNotifications({
      signals,
      mutedTitleIds: this.deps.getMutedTitleIds(),
      now,
      flags: this.deps.derivationFlags,
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
        actionJson: JSON.stringify(
          defaultNotificationActionIds({
            kind: notification.kind,
            hasItem: Boolean(notification.item),
          }),
        ),
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

  listAllActive(): NotificationRecord[] {
    return this.deps.repo.listAllActive();
  }

  listAllArchived(): NotificationRecord[] {
    return this.deps.repo.listAllArchived();
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
    this.deps.sinks?.dismiss?.(dedupKey);
    this.emitChange();
  }

  /**
   * Dismiss is archive. The old `dismissByDedupKey` set a `dismissed_at` column
   * that no query reads, while bumping `updated_at` — so a dismissed notice
   * stayed active AND unread AND jumped to the top of the inbox (which orders by
   * `updated_at DESC`): the exact inverse of dismissing it. The inbox already
   * worked around that by calling `archive` directly, so the two paths had
   * silently diverged and only non-inbox surfaces got the broken one.
   */
  dismiss(dedupKey: string, now = new Date().toISOString()): void {
    this.archive(dedupKey, now);
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

/**
 * The actions a notification offers.
 *
 * This is the only writer of `actionJson`, and the inbox filters the executable
 * action catalogue against what is stored here — so an id missing from this
 * function can never appear, however complete its handler is. It used to key on
 * kind alone and never emitted `play-now` or `open-details`, which is why a
 * "new episode" notice could not play the episode it announced and a completed
 * download could not play the file that had just finished.
 *
 * Playback and details are only offered when the notification actually carries a
 * media identity; otherwise the action would resolve to nothing.
 */
export function defaultNotificationActionIds(input: {
  readonly kind: string;
  readonly hasItem: boolean;
}): readonly string[] {
  if (input.kind === "queue-recovery") return ["restore-queue", "dismiss"];
  if (input.kind === "app-update") return ["update-app", "dismiss"];

  if (input.kind === "download-failed") {
    return input.hasItem
      ? ["retry-download", "open-details", "dismiss"]
      : ["retry-download", "dismiss"];
  }

  if (!input.hasItem) return ["dismiss"];

  if (input.kind === "download-complete") {
    return ["play-now", "open-details", "dismiss"];
  }

  // new-episode and anything else title-shaped.
  return ["play-now", "open-details", "add-to-up-next", "queue-end", "mute", "dismiss"];
}
