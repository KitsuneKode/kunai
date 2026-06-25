import type { FollowedTitlePreference } from "@kunai/storage";

import type { MediaItemIdentity } from "./media-item-identity";

export type MediaActionId =
  | "play-now"
  | "queue-next"
  | "queue-after-current-chain"
  | "queue-end"
  | "add-to-up-next"
  | "add-to-watchlist"
  | "add-to-playlist"
  | "download"
  | "follow"
  | "unfollow"
  | "mute"
  | "mark-watched"
  | "mark-unwatched"
  | "dismiss"
  | "open-details";

export type MediaActionSurface =
  | "notification"
  | "history"
  | "recommendation"
  | "search"
  | "post-playback"
  | "playlist"
  | "queue";

export interface MediaAction {
  readonly id: MediaActionId;
  readonly label: string;
  readonly dangerous?: boolean;
  readonly requiresConfirmation?: boolean;
}

export interface MediaActionPolicyInput {
  readonly item: MediaItemIdentity;
  readonly context: {
    readonly surface: MediaActionSurface;
    readonly playbackActive: boolean;
    readonly downloadsEnabled: boolean;
    readonly playlistsEnabled: boolean;
    readonly followEnabled: boolean;
    readonly canDismiss: boolean;
    readonly followPreference?: FollowedTitlePreference;
  };
}

export function getMediaActions(input: MediaActionPolicyInput): readonly MediaAction[] {
  const actions: MediaAction[] = [];
  const { context } = input;

  if (!context.playbackActive || context.surface !== "notification") {
    actions.push({
      id: "play-now",
      label: "Play now",
      requiresConfirmation: context.playbackActive,
    });
  }

  actions.push({ id: "queue-next", label: "Queue next" });
  actions.push({ id: "queue-after-current-chain", label: "Queue after current series" });
  actions.push({ id: "queue-end", label: "Queue at end" });
  actions.push({ id: "add-to-up-next", label: "Add to Up Next" });

  if (context.playlistsEnabled) {
    actions.push({ id: "add-to-watchlist", label: "Add to Watchlist" });
    actions.push({ id: "add-to-playlist", label: "Add to playlist" });
  }
  if (context.downloadsEnabled) {
    actions.push({ id: "download", label: "Download" });
  }
  if (context.followEnabled) {
    const preference = context.followPreference ?? "implicit";
    if (preference === "implicit") {
      actions.push({ id: "follow", label: "Follow releases" });
      actions.push({ id: "mute", label: "Mute release notices", dangerous: true });
    } else if (preference === "following") {
      actions.push({ id: "unfollow", label: "Unfollow releases" });
      actions.push({ id: "mute", label: "Mute release notices", dangerous: true });
    } else if (preference === "muted") {
      actions.push({ id: "unfollow", label: "Unmute release notices" });
    }
  }
  actions.push({ id: "open-details", label: "Open details" });
  if (context.canDismiss) {
    actions.push({ id: "dismiss", label: "Dismiss" });
  }

  return actions;
}
