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
      readonly catalogSource?: string;
      readonly availableAt: string;
      readonly streamUrl?: string;
    }
  | {
      readonly type: "queue-recoverable";
      readonly queueSessionId: string;
      readonly itemCount: number;
      readonly updatedAt: string;
    }
  | {
      readonly type: "download-complete";
      readonly titleId: string;
      readonly mediaKind: string;
      readonly title: string;
      readonly season?: number;
      readonly episode?: number;
    }
  | {
      readonly type: "download-failed";
      readonly titleId: string;
      readonly mediaKind: string;
      readonly title: string;
      readonly season?: number;
      readonly episode?: number;
      readonly error: string;
    }
  | {
      readonly type: "app-update";
      readonly currentVersion: string;
      readonly latestVersion: string;
    };

export interface DerivedNotification {
  readonly dedupKey: string;
  readonly kind:
    | "new-episode"
    | "queue-recovery"
    | "download-complete"
    | "download-failed"
    | "app-update";
  readonly title: string;
  readonly body: string;
  readonly item?: MediaItemIdentity;
  readonly queueSessionId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Gates which derived notification kinds are produced. Omitted/undefined fields
 * default to enabled, so callers that do not pass flags keep the full set.
 */
export interface NotificationDerivationFlags {
  readonly newEpisodeProjection?: boolean;
  readonly queueRecovery?: boolean;
}

export interface DeriveNotificationsInput {
  readonly signals: readonly NotificationSignal[];
  readonly mutedTitleIds: ReadonlySet<string>;
  readonly now: string;
  readonly flags?: NotificationDerivationFlags;
}

export function deriveNotifications(
  input: DeriveNotificationsInput,
): readonly DerivedNotification[] {
  const derived: DerivedNotification[] = [];
  for (const signal of input.signals) {
    if (signal.type === "new-playable-episode") {
      if (input.flags?.newEpisodeProjection === false) continue;
      if (input.mutedTitleIds.has(signal.titleId)) continue;
      const episodePart =
        signal.season !== undefined && signal.episode !== undefined
          ? `S${signal.season}E${signal.episode}`
          : "new episode";
      const body = signal.catalogSource
        ? `${episodePart} reported by catalog (${signal.catalogSource})`
        : `${episodePart} is available on ${signal.providerId}`;
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
        body,
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

    if (signal.type === "download-complete") {
      const episodePart =
        signal.season !== undefined && signal.episode !== undefined
          ? `S${signal.season}E${signal.episode}`
          : "download";
      derived.push({
        dedupKey: [
          "download-complete",
          signal.titleId,
          signal.season ?? "-",
          signal.episode ?? "-",
        ].join(":"),
        kind: "download-complete",
        title: `Downloaded · ${signal.title} ${episodePart}`,
        body: "Available offline",
        item: {
          mediaKind: signal.mediaKind,
          titleId: signal.titleId,
          title: signal.title,
          season: signal.season,
          episode: signal.episode,
          providerHints: sanitizeProviderHints([]),
        },
        createdAt: input.now,
        updatedAt: input.now,
      });
      continue;
    }

    if (signal.type === "download-failed") {
      const episodePart =
        signal.season !== undefined && signal.episode !== undefined
          ? `S${signal.season}E${signal.episode}`
          : "episode";
      derived.push({
        dedupKey: [
          "download-failed",
          signal.titleId,
          signal.season ?? "-",
          signal.episode ?? "-",
        ].join(":"),
        kind: "download-failed",
        title: `Download failed · ${signal.title} ${episodePart}`,
        body: signal.error,
        item: {
          mediaKind: signal.mediaKind,
          titleId: signal.titleId,
          title: signal.title,
          season: signal.season,
          episode: signal.episode,
          providerHints: sanitizeProviderHints([]),
        },
        createdAt: input.now,
        updatedAt: input.now,
      });
      continue;
    }

    if (signal.type === "app-update") {
      derived.push({
        dedupKey: `app-update:${signal.latestVersion}`,
        kind: "app-update",
        title: `Update available · ${signal.latestVersion}`,
        body: `You are on ${signal.currentVersion}. Update to ${signal.latestVersion}.`,
        createdAt: input.now,
        updatedAt: input.now,
      });
      continue;
    }

    if (input.flags?.queueRecovery === false) continue;
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
