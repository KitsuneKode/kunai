import type { MediaActionId } from "@/domain/media/media-action-policy";
import type { MediaItemIdentity } from "@/domain/media/media-item-identity";

export type QueuePlacement = "next" | "after-current-chain" | "end";

export interface MediaActionRouterDeps {
  readonly queue?: {
    readonly enqueueMediaItem: (
      item: MediaItemIdentity,
      options: { placement: QueuePlacement; source: string },
    ) => Promise<void> | void;
  };
  readonly playback?: {
    readonly playNow: (item: MediaItemIdentity) => Promise<void> | void;
  };
  readonly downloads?: {
    readonly queueDownload: (item: MediaItemIdentity) => Promise<void> | void;
  };
  readonly playlists?: {
    readonly addToPlaylist: (item: MediaItemIdentity) => Promise<void> | void;
  };
  readonly attention?: {
    readonly follow: (item: MediaItemIdentity) => Promise<void> | void;
    readonly mute: (item: MediaItemIdentity) => Promise<void> | void;
  };
  readonly details?: {
    readonly open: (item: MediaItemIdentity) => Promise<void> | void;
  };
  readonly notifications?: {
    readonly dismissByItem: (item: MediaItemIdentity) => Promise<void> | void;
  };
}

export interface RunMediaActionInput {
  readonly actionId: MediaActionId;
  readonly item: MediaItemIdentity;
  readonly source: string;
  readonly playbackActive?: boolean;
  readonly confirmedContextSwitch?: boolean;
  readonly confirmedProviderResolution?: boolean;
}

export class MediaActionRouter {
  constructor(private readonly deps: MediaActionRouterDeps) {}

  async run(input: RunMediaActionInput): Promise<void> {
    if (
      input.actionId === "play-now" &&
      input.playbackActive === true &&
      input.confirmedContextSwitch !== true
    ) {
      throw new Error("play-now requires confirmation while playback is active");
    }

    if (input.actionId === "play-now") {
      await requireAction(this.deps.playback?.playNow, "play-now")(input.item);
      return;
    }
    if (input.actionId === "queue-next") {
      await requireAction(this.deps.queue?.enqueueMediaItem, "queue-next")(input.item, {
        placement: "next",
        source: input.source,
      });
      return;
    }
    if (input.actionId === "queue-after-current-chain") {
      await requireAction(this.deps.queue?.enqueueMediaItem, "queue-after-current-chain")(
        input.item,
        {
          placement: "after-current-chain",
          source: input.source,
        },
      );
      return;
    }
    if (input.actionId === "queue-end") {
      await requireAction(this.deps.queue?.enqueueMediaItem, "queue-end")(input.item, {
        placement: "end",
        source: input.source,
      });
      return;
    }
    if (input.actionId === "download") {
      if (
        requiresProviderResolutionConfirmation(input.source) &&
        !input.confirmedProviderResolution
      ) {
        throw new Error("download requires provider resolution confirmation");
      }
      await requireAction(this.deps.downloads?.queueDownload, "download")(input.item);
      return;
    }
    if (input.actionId === "add-to-playlist") {
      await requireAction(this.deps.playlists?.addToPlaylist, "add-to-playlist")(input.item);
      return;
    }
    if (input.actionId === "follow") {
      await requireAction(this.deps.attention?.follow, "follow")(input.item);
      return;
    }
    if (input.actionId === "mute") {
      await requireAction(this.deps.attention?.mute, "mute")(input.item);
      return;
    }
    if (input.actionId === "open-details") {
      await requireAction(this.deps.details?.open, "open-details")(input.item);
      return;
    }
    if (input.actionId === "dismiss") {
      await requireAction(this.deps.notifications?.dismissByItem, "dismiss")(input.item);
    }
  }
}

function requireAction<TArgs extends readonly unknown[]>(
  fn: ((...args: TArgs) => Promise<void> | void) | undefined,
  actionId: MediaActionId,
): (...args: TArgs) => Promise<void> | void {
  if (!fn) {
    throw new Error(`media action is unavailable: ${actionId}`);
  }
  return fn;
}

function requiresProviderResolutionConfirmation(source: string): boolean {
  return source === "recommendation" || source === "post-playback-recommendation";
}
