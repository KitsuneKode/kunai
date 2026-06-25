import type { PostPlayState } from "@/domain/playback/post-play-state";

import { KEYBINDINGS, type KeyBinding } from "./keybindings";
import {
  buildPostPlayFooterActionsFromTitleControl,
  resolvePostPlayContinueResult,
} from "./title-control/title-control-post-play";
import type { FooterAction } from "./types";

export { resolvePostPlayContinueResult };

type PostPlayFooterOptions = {
  readonly canResume: boolean;
  readonly hasNextEpisode?: boolean;
  readonly hasNextSeason?: boolean;
  readonly providerCount?: number;
  readonly autoplayPaused?: boolean;
  readonly autoskipPaused?: boolean;
  readonly stopAfterCurrent?: boolean;
  readonly bindings?: readonly KeyBinding[];
};

export function buildPostPlayFooterActions(
  postPlayState: PostPlayState,
  options: PostPlayFooterOptions,
): readonly FooterAction[] {
  return buildPostPlayFooterActionsFromTitleControl(postPlayState, {
    canResume: options.canResume,
    hasNextEpisode: options.hasNextEpisode,
    hasNextSeason: options.hasNextSeason,
    providerCount: options.providerCount,
    bindings: options.bindings ?? KEYBINDINGS,
  });
}
