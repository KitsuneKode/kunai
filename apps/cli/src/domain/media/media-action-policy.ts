/**
 * Shared media action vocabulary.
 *
 * This file deliberately holds **only** the action id and shape. Deciding which
 * actions a surface offers lives in
 * `app-shell/title-control/title-control-actions.ts`, which is the single
 * policy the UI actually runs. A second per-surface policy previously lived
 * here and was never called; it was removed rather than wired, so there is one
 * place to change when a surface gains an action.
 */

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
  | "unmute"
  | "mute"
  | "mark-watched"
  | "mark-unwatched"
  | "dismiss"
  | "open-details";

export interface MediaAction {
  readonly id: MediaActionId;
  readonly label: string;
  readonly dangerous?: boolean;
  readonly requiresConfirmation?: boolean;
}
