import type { MediaActionId } from "@/domain/media/media-action-policy";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import type { RunMediaActionInput } from "@/services/media-actions/MediaActionRouter";
import type { NotificationRecord } from "@kunai/storage";

export type NotificationActionId = MediaActionId | "restore-queue";

export interface NotificationActionRouterDeps {
  readonly playlist?: {
    readonly restoreRecoverableSession: (sourceSessionId: string) => number | Promise<number>;
  };
  readonly mediaActions?: {
    readonly run: (input: RunMediaActionInput) => Promise<void> | void;
  };
  readonly notifications: {
    readonly dismiss: (dedupKey: string) => Promise<void> | void;
  };
}

export interface RunNotificationActionInput {
  readonly actionId: NotificationActionId;
  readonly notification: NotificationRecord;
  readonly playbackActive?: boolean;
  readonly confirmedContextSwitch?: boolean;
}

export class NotificationActionRouter {
  constructor(private readonly deps: NotificationActionRouterDeps) {}

  async run(input: RunNotificationActionInput): Promise<void> {
    if (input.actionId === "dismiss") {
      await this.deps.notifications.dismiss(input.notification.dedupKey);
      return;
    }

    if (input.actionId === "restore-queue") {
      const queueSessionId = parseQueueSessionId(input.notification);
      if (!queueSessionId) {
        throw new Error("restore-queue requires a queue session id");
      }
      await this.deps.playlist?.restoreRecoverableSession(queueSessionId);
      await this.deps.notifications.dismiss(input.notification.dedupKey);
      return;
    }

    const item = parseMediaItem(input.notification);
    if (!item) {
      throw new Error("notification action requires a media item payload");
    }

    await this.deps.mediaActions?.run({
      actionId: input.actionId,
      item,
      source: "notification",
      playbackActive: input.playbackActive,
      confirmedContextSwitch: input.confirmedContextSwitch,
    });
  }
}

export function parseNotificationActionIds(
  notification: NotificationRecord,
): readonly NotificationActionId[] {
  const parsed = parseJson(notification.actionJson);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isNotificationActionId);
}

function parseQueueSessionId(notification: NotificationRecord): string | null {
  const parsed = parseJson(notification.itemJson);
  if (!isRecord(parsed)) return null;
  return typeof parsed.queueSessionId === "string" && parsed.queueSessionId.length > 0
    ? parsed.queueSessionId
    : null;
}

export function parseNotificationMediaItem(
  notification: NotificationRecord,
): MediaItemIdentity | null {
  return parseMediaItem(notification);
}

function parseMediaItem(notification: NotificationRecord): MediaItemIdentity | null {
  const parsed = parseJson(notification.itemJson);
  if (!isRecord(parsed)) return null;
  if (
    typeof parsed.mediaKind !== "string" ||
    typeof parsed.titleId !== "string" ||
    typeof parsed.title !== "string"
  ) {
    return null;
  }

  return {
    mediaKind: parsed.mediaKind,
    sourceId: typeof parsed.sourceId === "string" ? parsed.sourceId : undefined,
    titleId: parsed.titleId,
    title: parsed.title,
    season: typeof parsed.season === "number" ? parsed.season : undefined,
    episode: typeof parsed.episode === "number" ? parsed.episode : undefined,
    absoluteEpisode:
      typeof parsed.absoluteEpisode === "number" ? parsed.absoluteEpisode : undefined,
    providerHints: Array.isArray(parsed.providerHints)
      ? (parsed.providerHints as MediaItemIdentity["providerHints"])
      : undefined,
  };
}

function parseJson(value: string | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotificationActionId(value: unknown): value is NotificationActionId {
  return (
    value === "restore-queue" ||
    value === "play-now" ||
    value === "queue-next" ||
    value === "queue-after-current-chain" ||
    value === "queue-end" ||
    value === "add-to-playlist" ||
    value === "download" ||
    value === "follow" ||
    value === "mute" ||
    value === "dismiss" ||
    value === "open-details"
  );
}
