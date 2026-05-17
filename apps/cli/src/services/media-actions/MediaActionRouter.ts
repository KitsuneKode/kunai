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
      await this.deps.playback?.playNow(input.item);
      return;
    }
    if (input.actionId === "queue-next") {
      await this.deps.queue?.enqueueMediaItem(input.item, {
        placement: "next",
        source: input.source,
      });
      return;
    }
    if (input.actionId === "queue-after-current-chain") {
      await this.deps.queue?.enqueueMediaItem(input.item, {
        placement: "after-current-chain",
        source: input.source,
      });
      return;
    }
    if (input.actionId === "queue-end") {
      await this.deps.queue?.enqueueMediaItem(input.item, {
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
      await this.deps.downloads?.queueDownload(input.item);
      return;
    }
    if (input.actionId === "dismiss") {
      await this.deps.notifications?.dismissByItem(input.item);
    }
  }
}

function requiresProviderResolutionConfirmation(source: string): boolean {
  return source === "recommendation" || source === "post-playback-recommendation";
}
