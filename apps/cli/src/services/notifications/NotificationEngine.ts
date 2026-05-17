import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import { sanitizeProviderHints } from "@/domain/media/media-item-identity";

export type NotificationSignal =
  | {
      readonly type: "new-playable-episode";
      readonly titleId: string;
      readonly mediaKind: string;
      readonly title: string;
      readonly season?: number;
      readonly episode?: number;
      readonly providerId: string;
      readonly availableAt: string;
      readonly streamUrl?: string;
    }
  | {
      readonly type: "queue-recoverable";
      readonly queueSessionId: string;
      readonly itemCount: number;
      readonly updatedAt: string;
    };

export interface DerivedNotification {
  readonly dedupKey: string;
  readonly kind: "new-episode" | "queue-recovery";
  readonly title: string;
  readonly body: string;
  readonly item?: MediaItemIdentity;
  readonly queueSessionId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DeriveNotificationsInput {
  readonly signals: readonly NotificationSignal[];
  readonly mutedTitleIds: ReadonlySet<string>;
  readonly now: string;
}

export function deriveNotifications(
  input: DeriveNotificationsInput,
): readonly DerivedNotification[] {
  const derived: DerivedNotification[] = [];
  for (const signal of input.signals) {
    if (signal.type === "new-playable-episode") {
      if (input.mutedTitleIds.has(signal.titleId)) continue;
      const episodePart =
        signal.season !== undefined && signal.episode !== undefined
          ? `S${signal.season}E${signal.episode}`
          : "new episode";
      derived.push({
        dedupKey: [
          "new-playable-episode",
          signal.titleId,
          signal.season ?? "-",
          signal.episode ?? "-",
          signal.providerId,
        ].join(":"),
        kind: "new-episode",
        title: `${signal.title} ${episodePart}`,
        body: `${episodePart} is available on ${signal.providerId}`,
        item: {
          mediaKind: signal.mediaKind,
          titleId: signal.titleId,
          title: signal.title,
          season: signal.season,
          episode: signal.episode,
          providerHints: sanitizeProviderHints([{ providerId: signal.providerId }]),
        },
        createdAt: input.now,
        updatedAt: input.now,
      });
      continue;
    }

    derived.push({
      dedupKey: `queue-recoverable:${signal.queueSessionId}`,
      kind: "queue-recovery",
      title: "Previous queue available",
      body: `${signal.itemCount} queued ${signal.itemCount === 1 ? "item" : "items"} can be restored`,
      queueSessionId: signal.queueSessionId,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }
  return derived;
}
