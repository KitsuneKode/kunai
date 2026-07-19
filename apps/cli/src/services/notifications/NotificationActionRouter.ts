import type { MediaActionId } from "@/domain/media/media-action-policy";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";
import type {
  MediaActionRunResult,
  RunMediaActionInput,
} from "@/services/media-actions/MediaActionRouter";
import type { NotificationRecord } from "@kunai/storage";

export type NotificationActionId =
  | MediaActionId
  | "restore-queue"
  | "retry-download"
  | "update-app";

export interface NotificationActionRouterDeps {
  readonly playlist?: {
    readonly restoreRecoverableSession: (sourceSessionId: string) => number | Promise<number>;
  };
  readonly mediaActions?: {
    readonly run: (
      input: RunMediaActionInput,
    ) => Promise<MediaActionRunResult> | MediaActionRunResult;
  };
  readonly appUpdate?: {
    /** Open the release page for the advertised version (null when unknown). */
    readonly openReleasePage: (latestVersion: string | null) => Promise<boolean> | boolean;
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

export type NotificationActionRunResult =
  | { readonly status: "handled"; readonly actionId: NotificationActionId }
  | {
      readonly status: "unsupported";
      readonly actionId: NotificationActionId;
      readonly reason: string;
    };

function handled(actionId: NotificationActionId): NotificationActionRunResult {
  return { status: "handled", actionId };
}

function unsupported(actionId: NotificationActionId): NotificationActionRunResult {
  return {
    status: "unsupported",
    actionId,
    reason: `No executor registered for ${actionId}`,
  };
}

export class NotificationActionRouter {
  constructor(private readonly deps: NotificationActionRouterDeps) {}

  /**
   * Executes the stored notification action and reports whether an executor
   * actually handled it. Only the stored `dismiss` action mutates notification
   * lifecycle state here; every other outcome (mark-read on success) is the
   * caller's policy.
   */
  async run(input: RunNotificationActionInput): Promise<NotificationActionRunResult> {
    if (input.actionId === "dismiss") {
      await this.deps.notifications.dismiss(input.notification.dedupKey);
      return handled(input.actionId);
    }

    if (input.actionId === "restore-queue") {
      const queueSessionId = parseQueueSessionId(input.notification);
      if (!queueSessionId) {
        throw new Error("restore-queue requires a queue session id");
      }
      const restore = this.deps.playlist?.restoreRecoverableSession;
      if (!restore) return unsupported(input.actionId);
      const restoredCount = await restore(queueSessionId);
      if (restoredCount <= 0) {
        return {
          status: "unsupported",
          actionId: input.actionId,
          reason: "Queue session is no longer recoverable",
        };
      }
      return handled(input.actionId);
    }

    if (input.actionId === "update-app") {
      const openReleasePage = this.deps.appUpdate?.openReleasePage;
      if (!openReleasePage) return unsupported(input.actionId);
      const opened = await openReleasePage(parseAppUpdateVersion(input.notification));
      return opened
        ? handled(input.actionId)
        : {
            status: "unsupported",
            actionId: input.actionId,
            reason: "Release page could not be opened",
          };
    }

    const item = parseMediaItem(input.notification);
    if (!item) {
      throw new Error("notification action requires a media item payload");
    }

    // Retry maps to the standard download media action for the same item.
    const mediaActionId: MediaActionId =
      input.actionId === "retry-download" ? "download" : input.actionId;

    const runMediaAction = this.deps.mediaActions?.run;
    if (!runMediaAction) return unsupported(input.actionId);
    const result = await runMediaAction({
      actionId: mediaActionId,
      item,
      source: "notification",
      playbackActive: input.playbackActive,
      confirmedContextSwitch: input.confirmedContextSwitch,
    });
    return result.status === "handled"
      ? handled(input.actionId)
      : {
          status: "unsupported",
          actionId: input.actionId,
          reason: result.reason,
        };
  }
}

export function parseNotificationActionIds(
  notification: NotificationRecord,
): readonly NotificationActionId[] {
  const parsed = parseJson(notification.actionJson);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isNotificationActionId);
}

/**
 * The app-update notification encodes its target version in the dedupKey
 * (`app-update:<version>`, see NotificationEngine). Returns null if absent.
 */
export function parseAppUpdateVersion(notification: NotificationRecord): string | null {
  const prefix = "app-update:";
  if (!notification.dedupKey.startsWith(prefix)) return null;
  const version = notification.dedupKey.slice(prefix.length).trim();
  return version.length > 0 ? version : null;
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
    value === "retry-download" ||
    value === "update-app" ||
    value === "play-now" ||
    value === "queue-next" ||
    value === "queue-after-current-chain" ||
    value === "queue-end" ||
    value === "add-to-up-next" ||
    value === "add-to-watchlist" ||
    value === "add-to-playlist" ||
    value === "download" ||
    value === "follow" ||
    value === "unfollow" ||
    value === "unmute" ||
    value === "mute" ||
    value === "dismiss" ||
    value === "open-details"
  );
}
