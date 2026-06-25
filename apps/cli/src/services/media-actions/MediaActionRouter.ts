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
  readonly watchlist?: {
    readonly addToWatchlist: (item: MediaItemIdentity) => Promise<void> | void;
  };
  readonly attention?: {
    readonly follow: (item: MediaItemIdentity) => Promise<void> | void;
    readonly unfollow: (item: MediaItemIdentity) => Promise<void> | void;
    readonly unmute?: (item: MediaItemIdentity) => Promise<void> | void;
    readonly mute: (item: MediaItemIdentity) => Promise<void> | void;
  };
  readonly history?: {
    readonly markWatched: (item: MediaItemIdentity) => Promise<void> | void;
    readonly markUnwatched?: (item: MediaItemIdentity) => Promise<void> | void;
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

export type MediaActionRunResult =
  | { readonly status: "handled"; readonly actionId: MediaActionId }
  | { readonly status: "unsupported"; readonly actionId: MediaActionId; readonly reason: string };

export class MediaActionRouter {
  constructor(private readonly deps: MediaActionRouterDeps) {}

  async run(input: RunMediaActionInput): Promise<MediaActionRunResult> {
    if (
      input.actionId === "play-now" &&
      input.playbackActive === true &&
      input.confirmedContextSwitch !== true
    ) {
      throw new Error("play-now requires confirmation while playback is active");
    }

    switch (input.actionId) {
      case "play-now": {
        const executor = this.deps.playback?.playNow;
        if (!executor) return unsupported(input.actionId);
        await executor(input.item);
        return handled(input.actionId);
      }
      case "queue-next": {
        const executor = this.deps.queue?.enqueueMediaItem;
        if (!executor) return unsupported(input.actionId);
        await executor(input.item, {
          placement: "next",
          source: input.source,
        });
        return handled(input.actionId);
      }
      case "queue-after-current-chain": {
        const executor = this.deps.queue?.enqueueMediaItem;
        if (!executor) return unsupported(input.actionId);
        await executor(input.item, {
          placement: "after-current-chain",
          source: input.source,
        });
        return handled(input.actionId);
      }
      case "queue-end": {
        const executor = this.deps.queue?.enqueueMediaItem;
        if (!executor) return unsupported(input.actionId);
        await executor(input.item, {
          placement: "end",
          source: input.source,
        });
        return handled(input.actionId);
      }
      case "add-to-up-next": {
        const executor = this.deps.queue?.enqueueMediaItem;
        if (!executor) return unsupported(input.actionId);
        await executor(input.item, {
          placement: "end",
          source: input.source,
        });
        return handled(input.actionId);
      }
      case "download": {
        if (
          requiresProviderResolutionConfirmation(input.source) &&
          !input.confirmedProviderResolution
        ) {
          throw new Error("download requires provider resolution confirmation");
        }
        const executor = this.deps.downloads?.queueDownload;
        if (!executor) return unsupported(input.actionId);
        await executor(input.item);
        return handled(input.actionId);
      }
      case "add-to-playlist": {
        const executor = this.deps.playlists?.addToPlaylist;
        if (!executor) return unsupported(input.actionId);
        await executor(input.item);
        return handled(input.actionId);
      }
      case "add-to-watchlist": {
        const executor = this.deps.watchlist?.addToWatchlist;
        if (!executor) return unsupported(input.actionId);
        await executor(input.item);
        return handled(input.actionId);
      }
      case "follow": {
        const executor = this.deps.attention?.follow;
        if (!executor) return unsupported(input.actionId);
        await executor(input.item);
        return handled(input.actionId);
      }
      case "unfollow": {
        const executor = this.deps.attention?.unfollow;
        if (!executor) return unsupported(input.actionId);
        await executor(input.item);
        return handled(input.actionId);
      }
      case "unmute": {
        const executor = this.deps.attention?.unmute ?? this.deps.attention?.unfollow;
        if (!executor) return unsupported(input.actionId);
        await executor(input.item);
        return handled(input.actionId);
      }
      case "mute": {
        const executor = this.deps.attention?.mute;
        if (!executor) return unsupported(input.actionId);
        await executor(input.item);
        return handled(input.actionId);
      }
      case "mark-watched": {
        const executor = this.deps.history?.markWatched;
        if (!executor) return unsupported(input.actionId);
        await executor(input.item);
        return handled(input.actionId);
      }
      case "mark-unwatched": {
        const executor = this.deps.history?.markUnwatched;
        if (!executor) return unsupported(input.actionId);
        await executor(input.item);
        return handled(input.actionId);
      }
      case "open-details": {
        const executor = this.deps.details?.open;
        if (!executor) return unsupported(input.actionId);
        await executor(input.item);
        return handled(input.actionId);
      }
      case "dismiss": {
        const executor = this.deps.notifications?.dismissByItem;
        if (!executor) return unsupported(input.actionId);
        await executor(input.item);
        return handled(input.actionId);
      }
      default: {
        // Exhaustiveness guard: a displayed action with no router branch must fail
        // loudly rather than resolve as a silent no-op success.
        const unsupportedAction: never = input.actionId;
        throw new Error(`media action is unsupported: ${String(unsupportedAction)}`);
      }
    }
  }
}

function handled(actionId: MediaActionId): MediaActionRunResult {
  return { status: "handled", actionId };
}

function unsupported(actionId: MediaActionId): MediaActionRunResult {
  return { status: "unsupported", actionId, reason: `No executor registered for ${actionId}` };
}

function requiresProviderResolutionConfirmation(source: string): boolean {
  return source === "recommendation" || source === "post-playback-recommendation";
}
